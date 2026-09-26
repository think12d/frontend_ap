import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  CalendarDays,
  CircleUserRound,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  ImagePlus,
  LayoutDashboard,
  Library,
  ListChecks,
  Lock,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Pencil,
  Phone,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Save,
  Settings,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  api,
  apiBlob,
  API_URL,
  ApiError,
  clearStoredToken,
  getStoredToken,
  storeToken,
} from "./api";
import type {
  Course,
  JRFStrategyPlan,
  LiveClass,
  Module,
  Notification,
  PaginatedCourseListResponse,
  PaymentReceipt,
  PremiumAccess,
  QuestionLibrary,
  QuestionLibraryFile,
  Quiz,
  QuizAttempt,
  QuizResult,
  RazorpayOrder,
  RecordedLibrary,
  NotificationSettings,
  StudyPlan,
  Topic,
  User,
} from "./types";
import AdminLiveDashboard from "./components/AdminLiveDashboard";
import LiveClassCard from "./components/LiveClassCard";
import LiveClassRoomPanel from "./components/LiveClassRoomPanel";
import RecordingCard from "./components/RecordingCard";
import ResourceMedia from "./components/ResourceMedia";
import { NotificationProvider, useNotifications } from "./notifications";

const appMode = import.meta.env.VITE_APP_MODE || "user";
const isAdminApp = appMode === "admin";
const adminAppUrl =
  import.meta.env.VITE_ADMIN_URL || "http://localhost:5174/admin/login";
const learnerAppUrl =
  import.meta.env.VITE_LEARNER_URL || "http://localhost:5173/login";
type QuestionBankOptions = {
  available: boolean;
  years: number[];
  categories: string[];
  topics: string[];
  subtopics: string[];
  difficulties: string[];
  sessions: string[];
  papers: string[];
  subjects: { code: string; name: string }[];
  status: string;
};

type QuizDraftState = {
  quiz: Quiz;
  answers: Record<string, number>;
  currentIndex: number;
  startedAt: number;
  expiresAt: number;
  savedAt: number;
};

function quizDraftKey(user: User | null): string {
  return `jar_quiz_active_${user ? user.id : "guest"}`;
}

function readQuizDraft(user: User | null): QuizDraftState | null {
  if (typeof window === "undefined") return null;
  const key = quizDraftKey(user);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QuizDraftState>;
    const currentIndex = Number.isFinite(parsed.currentIndex) ? Number(parsed.currentIndex) : 0;
    const startedAt = Number.isFinite(parsed.startedAt) ? Number(parsed.startedAt) : Date.now();
    const expiresAt = Number.isFinite(parsed.expiresAt) ? Number(parsed.expiresAt) : Date.now() + 60_000;
    const savedAt = Number.isFinite(parsed.savedAt) ? Number(parsed.savedAt) : Date.now();
    if (!parsed.quiz || typeof parsed.expiresAt !== "number") {
      window.localStorage.removeItem(key);
      return null;
    }
    if (expiresAt <= Date.now()) {
      window.localStorage.removeItem(key);
      return null;
    }
    return {
      quiz: parsed.quiz,
      answers: parsed.answers || {},
      currentIndex,
      startedAt,
      expiresAt,
      savedAt,
    };
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function persistQuizDraft(user: User | null, draft: QuizDraftState | null): void {
  if (typeof window === "undefined") return;
  const key = quizDraftKey(user);
  if (!draft) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(draft));
}

function formatQuizTimer(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const remainder = String(total % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function resourceMatchesType(resource: { resource_type: string; original_filename: string }, filter: string): boolean {
  if (filter === "all") return true;
  if (resource.resource_type === filter) return true;
  const extension = resource.original_filename.split(".").pop()?.toLowerCase();
  const extensions: Record<string, string[]> = {
    pdf: ["pdf"],
    document: ["doc", "docx", "txt", "rtf"],
    presentation: ["ppt", "pptx"],
    spreadsheet: ["xls", "xlsx", "csv"],
    image: ["jpg", "jpeg", "png", "gif", "webp"],
    audio: ["mp3", "wav", "m4a", "aac"],
    video: ["mp4", "webm", "mov", "mkv", "avi"],
  };
  return extensions[filter]?.includes(extension || "") ?? false;
}

type PaymentCompletion = {
  paid: boolean;
  premium_access?: boolean;
  receipt?: PaymentReceipt;
};

type RazorpayPaymentResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCheckout = {
  open: () => void;
  on: (event: string, handler: (response: unknown) => void) => void;
};
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-razorpay-checkout="true"]',
  );
  if (existing)
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Razorpay Checkout could not be loaded.")),
        { once: true },
      );
    });
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Razorpay Checkout could not be loaded."));
    document.body.appendChild(script);
  });
}

async function startPremiumCheckout(
  onPaid: (receipt?: PaymentReceipt) => Promise<void> | void,
  onError: (message: string) => void,
  orderBody: Record<string, unknown> = {},
) {
  try {
    const order = await api<RazorpayOrder>("/payments/razorpay/order", {
      method: "POST",
      body: JSON.stringify(orderBody),
    });
    if (order.already_paid || order.already_enrolled) {
      await onPaid();
      return;
    }
    if (order.mock_mode && order.order_id) {
      const result = await api<PaymentCompletion>("/payments/mock/complete", {
        method: "POST",
        body: JSON.stringify({ order_id: order.order_id }),
      });
      await onPaid(result.receipt);
      return;
    }
    if (!order.key_id || !order.order_id || !order.amount || !order.currency)
      throw new Error("Razorpay order details are incomplete.");
    await loadRazorpayCheckout();
    if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
    let terminalEventReported = false;
    const reportTerminalEvent = (
      endpoint: string,
      payload: Record<string, unknown>,
      message: string,
    ) => {
      if (terminalEventReported) return;
      terminalEventReported = true;
      void api(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      }).catch(() => undefined);
      onError(message);
    };
    const checkout = new window.Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: order.name || "UGC NET JAR",
      description: order.description || "Premium access",
      order_id: order.order_id,
      prefill: order.prefill || { name: "", email: "" },
      theme: { color: "#138f9c" },
      handler: async (response: RazorpayPaymentResponse) => {
        terminalEventReported = true;
        try {
          const result = await api<PaymentCompletion>(
            "/payments/razorpay/verify",
            { method: "POST", body: JSON.stringify(response) },
          );
          await onPaid(result.receipt);
        } catch (cause) {
          onError((cause as Error).message);
        }
      },
      modal: {
        ondismiss: () =>
          reportTerminalEvent(
            "/payments/razorpay/cancel",
            {
              razorpay_order_id: order.order_id,
              reason: "customer_cancelled",
              description: "Customer closed Razorpay Checkout.",
            },
            "Payment was cancelled. You can retry from this payment page.",
          ),
      },
    });
    checkout.on("payment.failed", (failure) => {
      const detail = failure as {
        error?: { code?: string; description?: string; reason?: string };
      };
      reportTerminalEvent(
        "/payments/razorpay/failure",
        {
          razorpay_order_id: order.order_id,
          code: detail.error?.code || "payment_failed",
          description:
            detail.error?.description ||
            "The UPI provider could not complete this payment.",
          reason: detail.error?.reason,
        },
        `Razorpay payment failed: ${detail.error?.description || detail.error?.reason || "The UPI provider could not complete this payment."}`,
      );
    });
    checkout.open();
  } catch (cause) {
    onError((cause as Error).message);
  }
}

function PremiumPaywall({
  access,
  feature,
  onPaid,
}: {
  access: PremiumAccess | null;
  feature: "mock" | "live" | "recorded" | "library";
  onPaid: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!access || (feature === "mock" ? access.mock_test_access : access.premium_access)) return null;
  const freeAvailable = feature === "mock" ? access.free_mock_available : false;
  const start = () => {
    setBusy(true);
    setError("");
    void startPremiumCheckout(
      async () => {
        await onPaid();
        setBusy(false);
      },
      (message) => {
        setBusy(false);
        setError(message);
      },
      feature === "mock" ? { product: "mock_test_unlimited_access" } : {},
    );
  };
  return (
    <div className="notice premium-paywall">
      <b>{freeAvailable ? `${access.free_mock_attempts_remaining} free mock attempts remaining` : "Paid access required"}</b>
      <span>
        {freeAvailable
          ? "Use your remaining free mock tests before choosing unlimited access."
          : feature === "library"
            ? "The question archive and recorded classes unlock after a successful paid course enrollment or premium payment."
            : feature === "recorded"
              ? "Recorded classes are available after a successful paid course enrollment or premium payment."
              : "Your free mock-test attempts are used. One successful payment unlocks unlimited mock-test access."}
      </span>
      {!access.razorpay_configured && !access.mock_mode ? (
        <small>Razorpay is not configured on the server.</small>
      ) : (
        <button
          className="button button-lime button-small"
          type="button"
          disabled={busy}
          onClick={start}
        >
          {busy
            ? "Opening payment…"
            : access.mock_mode
              ? "Complete mock payment"
                : `Unlock ${feature === "mock" ? "mock tests" : "premium"} · ${access.currency} ${((feature === "mock" ? access.mock_test_price_paise : access.premium_price_paise) / 100).toLocaleString("en-IN")}`}
        </button>
      )}
      {error && <small>{error}</small>}
    </div>
  );
}

function parseYearList(value: string): number[] {
  return value
    .split(/[\s,;]+/)
    .map((part) => Number(part.trim()))
    .filter((year) => Number.isInteger(year) && year >= 2010 && year <= 2100);
}

const DEMO_COURSES: Course[] = [
  {
    id: 101,
    slug: "aagaz-batch-paper-1",
    title: "AAGAZ BATCH – Paper 1",
    subject: "UGC NET Paper 1",
    description: "Structured Paper 1 preparation with aptitude, reasoning, ICT, environment and higher-education units.",
    batch_type: "batch",
    access_period: "year",
    is_published: true,
    is_featured: true,
    price_paise: 249900,
    access_duration_days: 365,
    launch_at: null,
    enrollment_deadline: null,
    max_students: 150,
    is_enrolled: true,
    access_expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString(),
    seats_remaining: 42,
    availability_status: "enrolled",
    modules: [],
  },
];

const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: 1,
    title: "Study reminder",
    message: "Your daily revision block is scheduled for today. Keep your momentum alive.",
    category: "study",
    audience: "student",
    is_global: false,
    link_url: "/study-planner",
    created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: 2,
    title: "Live class update",
    message: "A new Paper 1 live session has been added to your learning track.",
    category: "meeting",
    audience: "student",
    is_global: false,
    link_url: "/live",
    created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
];

const DEMO_ATTEMPTS: QuizAttempt[] = [
  {
    id: 1,
    quiz_id: 1,
    quiz_title: "UGC NET Practice Quiz",
    status: "completed",
    score: 38,
    correct: 38,
    total: 50,
    answers: {},
    current_index: 0,
    topic_scores: {},
    report: "",
    strong_topics: [],
    report_available: false,
    time_spent_seconds: 900,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
  },
];


function AppContent() {
  const notifications = useNotifications();
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const authCheckStarted = useRef(false);

  useEffect(() => {
    const onAuthExpired = () => {
      setUser(null);
      notifications.showToast({
        kind: "warning",
        title: "Session expired",
        message: "Please sign in again to continue.",
      });
    };
    window.addEventListener("jar-auth-expired", onAuthExpired);
    return () => window.removeEventListener("jar-auth-expired", onAuthExpired);
  }, [notifications]);

  useEffect(() => {
    if (authCheckStarted.current) return;
    authCheckStarted.current = true;
    if (!getStoredToken()) {
      setBooting(false);
      return;
    }
    api<User>("/auth/me")
      .then(setUser)
      .catch(() => clearStoredToken())
      .finally(() => setBooting(false));
  }, []);

  const logout = () => {
    clearStoredToken();
    setUser(null);
    notifications.showToast({
      kind: "info",
      title: "Signed out",
      message: "You have been logged out successfully.",
    });
  };

  if (booting)
    return (
      <div className="page-loader">
        <div className="loader-dot" />
        Loading your studio…
      </div>
    );

  const routes = isAdminApp ? (
    <Routes>
      <Route path="/admin/login" element={<AdminLogin onLogin={setUser} />} />
      <Route element={<AdminShell user={user} onLogout={logout} />}>
        <Route path="/admin" element={<Admin user={user} />} />
        <Route path="/admin/payments" element={<AdminPayments user={user} />} />
        <Route path="/admin/user-access" element={<AdminUserAccessPage user={user} />} />
        <Route path="/admin/user-access/:userId" element={<AdminUserAccessDetailPage user={user} />} />
        <Route path="/admin/live" element={<UnifiedAdminLivePage user={user} />} />
        <Route path="/admin/recorded-videos" element={<AdminRecordedVideosPage user={user} />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin/login" replace />} />
    </Routes>
  ) : (
    <Routes>
      <Route path="/login" element={<Login onLogin={setUser} />} />
      <Route element={<LearnerShell user={user} onLogout={logout} />}>
        <Route path="/" element={<Home user={user} />} />
        <Route path="/courses" element={<Home user={user} />} />
        <Route path="/profile" element={<ComingSoonPage title="Profile" description="Profile editing is not backed by a server endpoint yet, so this area is intentionally kept as a placeholder until the backend exposes the profile API." />} />
        <Route path="/certificates" element={<ComingSoonPage title="Certificates" description="Certificate listing is not yet backed by a dedicated endpoint, so this area is intentionally kept as a placeholder until the backend exposes the certificate API." />} />
        <Route path="/course/:slug" element={<CoursePage user={user} />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/terms" element={<LegalPage page="terms" />} />
        <Route path="/privacy" element={<LegalPage page="privacy" />} />
        <Route path="/refunds" element={<LegalPage page="refunds" />} />
        <Route path="/grievances" element={<LegalPage page="grievances" />} />
        <Route element={<RequireUser user={user} />}>
          <Route path="/registered-courses" element={<RegisteredCoursesPage user={user} />} />
          <Route path="/dashboard" element={<DashboardPage user={user} />} />
          <Route path="/my-learning" element={<MyLearningPage user={user} />} />
          <Route path="/notifications" element={<NotificationsPage user={user} />} />
          <Route path="/notification-settings" element={<NotificationSettingsPage user={user} />} />
          <Route path="/payment/course/:slug" element={<PaymentPage user={user} />} />
          <Route path="/ai-lab" element={<AiLabWithImage user={user} />} />
          <Route path="/study-planner" element={<StudyPlanner user={user} />} />
          <Route path="/jrf-strategy" element={<JRFStrategyBuilder user={user} />} />
          <Route path="/mock-tests" element={<MockTests user={user} />} />
          <Route path="/question-bank" element={<QuestionBankPage user={user} />} />
          <Route path="/recorded-classes" element={<RecordedVideoLibraryPage user={user} />} />
          <Route path="/live" element={<UnifiedLivePage user={user} />} />
          <Route path="/live/:liveClassId" element={<FullLiveClassPage user={user} />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  return routes;
}

function RequireUser({ user }: { user: User | null }) {
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function App() {
  return (
    <NotificationProvider>
      <style>{`@keyframes toast-in { 0% { opacity: 0; transform: translateY(-6px) scale(0.98); } 100% { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
      <AppContent />
    </NotificationProvider>
  );
}

function NotificationCenter({ user }: { user: User | null }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const navigate = useNavigate();
  const notifications = useNotifications();

  const reload = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const next = await api<Notification[]>("/notifications?include_read=true");
      setItems(next);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void reload();
    const timer = window.setInterval(() => void reload(), 30000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const didClickOutside =
        panelRef.current && !panelRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target);

      if (didClickOutside) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!user) return null;

  const unreadCount = items.filter((item) => !item.read_at).length;

  const formatTimestamp = (value: string) => {
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    const minutes = Math.max(1, Math.round(diff / 60000));

    if (diff < 60 * 60 * 1000) {
      return `${minutes} min ago`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.max(1, Math.round(diff / (60 * 60 * 1000)));
      return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    }
    if (diff < 48 * 60 * 60 * 1000) {
      return "Yesterday";
    }

    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    });
  };

  const categoryTone = (value: string) => {
    const category = value.toLowerCase();
    if (category.includes("meeting") || category.includes("live")) return "meeting";
    if (category.includes("study") || category.includes("plan")) return "study";
    if (category.includes("record") || category.includes("video")) return "recording";
    if (category.includes("payment") || category.includes("billing")) return "payment";
    return "general";
  };

  const markRead = async (notificationId: number): Promise<boolean> => {
    try {
      await api(`/notifications/read/${notificationId}`, { method: "POST" });
      setItems((current) =>
        current.map((item) =>
          item.id === notificationId
            ? { ...item, read_at: new Date().toISOString() }
            : item,
        ),
      );
      notifications.showToast({ kind: "success", title: "Notification marked as read", message: "The notification was updated." });
      return true;
    } catch (cause) {
      notifications.showToast({ kind: "error", title: "Could not mark notification as read", message: (cause as Error).message || "Please try again." });
      return false;
    }
  };

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    try {
      await api("/notifications/read-all", { method: "POST" });
      setItems((current) =>
        current.map((item) => ({
          ...item,
          read_at: item.read_at ?? new Date().toISOString(),
        })),
      );
      notifications.showToast({ kind: "success", title: "All notifications marked as read", message: "Your notification list is up to date." });
    } catch (cause) {
      notifications.showToast({ kind: "error", title: "Could not mark all notifications as read", message: (cause as Error).message || "Please try again." });
    }
  };

  const handleOpen = async (item: Notification) => {
    if (!item.read_at) {
      const markedRead = await markRead(item.id);
      if (!markedRead) return;
    }
    if (!item.link_url) return;
    setIsOpen(false);
    navigate(item.link_url);
  };

  return (
    <div className="notification-shell">
      <button
        ref={triggerRef}
        type="button"
        className={`notification-trigger ${isOpen ? "is-open" : ""}`}
        aria-label="Notifications"
        aria-expanded={isOpen}
        aria-controls="notification-panel"
        onClick={() => setIsOpen((value) => !value)}
      >
        <Bell size={16} />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            className="notification-backdrop"
            aria-label="Close notifications"
            onClick={() => setIsOpen(false)}
          />
          <div
            ref={panelRef}
            id="notification-panel"
            className="notification-panel"
            role="dialog"
            aria-label="Notifications panel"
          >
          <div className="notification-header">
              <div className="notification-title-wrap">
                <span className="notification-header-icon">
                  <Bell size={15} />
                </span>
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <span className="notification-badge notification-badge-inline">
                    {unreadCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="notification-close"
                aria-label="Close notifications"
                onClick={() => setIsOpen(false)}
              >
                <X size={17} />
              </button>
              <div className="notification-header-actions">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    className="button-link notification-mark-all"
                    onClick={() => void markAllRead()}
                  >
                    Mark all as read
                  </button>
                )}
                <Link
                  to="/notification-settings"
                  className="notification-settings-link"
                  onClick={() => setIsOpen(false)}
                >
                  <Settings size={15} />
                  <span>Notification Settings</span>
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>

          {loading && items.length === 0 ? (
            <div className="notification-empty">
              <div className="notification-empty-icon">🔔</div>
              <h4>Checking for updates…</h4>
            </div>
          ) : items.length === 0 ? (
            <div className="notification-empty">
              <div className="notification-empty-icon">🔔</div>
              <h4>You’re all caught up</h4>
              <p>No new notifications right now.</p>
            </div>
          ) : (
            <div className="notification-list" aria-live="polite">
              {items.map((item) => (
                <article
                  key={item.id}
                  className={`notification-item ${item.read_at ? "is-read" : "is-unread"}`}
                  onClick={() => void handleOpen(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void handleOpen(item);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="notification-item-topline">
                    <div className="notification-item-meta">
                      {!item.read_at && <span className="notification-dot" />}
                      <span className={`notification-category tone-${categoryTone(item.category)}`}>
                        {item.category}
                      </span>
                    </div>
                    <div className="notification-item-topline-end">
                      <span className="notification-time">
                        {formatTimestamp(item.created_at)}
                      </span>
                      {!item.read_at && (
                        <button
                          type="button"
                          className="notification-mark-read-icon"
                          aria-label={`Mark ${item.title} as read`}
                          title="Mark as read"
                          onClick={(event) => {
                            event.stopPropagation();
                            void markRead(item.id);
                          }}
                        >
                          <Check size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  <h4>{item.title}</h4>
                  <p>{item.message}</p>
                </article>
              ))}
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}

function NotificationSettingsPage({ user }: { user: User | null }) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const notifications = useNotifications();

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api<NotificationSettings>("/notifications/settings")
      .then(setSettings)
      .catch((cause) => setMessage((cause as Error).message))
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (!user) return <Navigate to="/login" replace />;

  const preferences: { key: keyof NotificationSettings; label: string; description: string }[] = [
    { key: "live_class_reminders", label: "Live class reminders", description: "Scheduled classes and classroom start alerts." },
    { key: "new_recorded_videos", label: "New recorded videos", description: "When a completed live class is ready to watch." },
    { key: "course_updates", label: "Course updates", description: "Changes and announcements about your courses." },
    { key: "study_reminders", label: "Study reminders", description: "Study plans and preparation prompts." },
    { key: "mock_tests_results", label: "Mock tests/results", description: "Quiz availability, scores and reports." },
    { key: "progress_completion", label: "Progress/completion", description: "Milestones and completed learning activity." },
    { key: "payment_account_updates", label: "Payment/account updates", description: "Receipts, access and account activity." },
    { key: "email_notifications", label: "Email notifications", description: "Allow eligible learning notifications to reach your inbox." },
    { key: "quiet_hours", label: "Quiet hours", description: "Pause notification delivery until you turn this off." },
  ];

  const updateSetting = async (key: keyof NotificationSettings, value: boolean) => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, [key]: value });
    setSaving(key);
    setMessage("");
    try {
      const saved = await api<NotificationSettings>("/notifications/settings", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value }),
      });
      setSettings(saved);
      setMessage("Notification preferences saved.");
      notifications.showToast({ kind: "success", title: "Notification preference saved", message: "Your setting was updated successfully." });
    } catch (cause) {
      setSettings(previous);
      const errorMessage = (cause as Error).message || "Could not save notification preferences.";
      setMessage(errorMessage);
      notifications.showToast({ kind: "error", title: "Unable to update notification preference", message: errorMessage });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="page-shell notification-settings-page">
      <div className="page-header-row">
        <div>
          <span className="eyebrow">NOTIFICATION SETTINGS</span>
          <h1>Choose what reaches you.</h1>
          <p className="muted">Your preferences are saved to your account and apply across your devices.</p>
        </div>
        <Settings size={28} aria-hidden="true" />
      </div>
      {message && <div className="notice" role="status">{message}</div>}
      {loading || !settings ? (
        <div className="empty-state">Loading your notification preferences…</div>
      ) : (
        <section className="notification-settings-card panel">
          <div className="notification-setting-row notification-setting-primary">
            <div>
              <strong>All notifications</strong>
              <span>Master switch for in-app notifications.</span>
            </div>
            <button
              type="button"
              className={`settings-toggle ${settings.all_notifications ? "is-on" : ""}`}
              aria-pressed={settings.all_notifications}
              onClick={() => void updateSetting("all_notifications", !settings.all_notifications)}
              disabled={saving === "all_notifications"}
            >
              <span />
              <b>{settings.all_notifications ? "On" : "Off"}</b>
            </button>
          </div>
          <div className="notification-settings-list">
            {preferences.map(({ key, label, description }) => (
              <div className="notification-setting-row" key={key}>
                <div>
                  <strong>{label}</strong>
                  <span>{description}</span>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${settings[key] ? "is-on" : ""}`}
                  aria-label={`${label}: ${settings[key] ? "on" : "off"}`}
                  aria-pressed={settings[key]}
                  onClick={() => void updateSetting(key, !settings[key])}
                  disabled={saving === key}
                >
                  <span />
                  <b>{settings[key] ? "On" : "Off"}</b>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ComingSoonPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="page-shell">
      <div className="empty-state page-empty-state">
        <Sparkles size={32} />
        <h3>{title}</h3>
        <p>{description}</p>
        <Link className="button button-dark" to="/dashboard">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

function DashboardPage({ user }: { user: User | null }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setFetchError("");
      try {
        const [courseResult, notificationResult, attemptResult] = await Promise.all([
          api<Course[]>('/courses/dashboard'),
          api<Notification[]>('/notifications?include_read=true').catch(() => []),
          api<QuizAttempt[]>('/quizzes/attempts/me').catch(() => []),
        ]);
        if (!active) return;
        setCourses(courseResult);
        setNotifications(notificationResult.slice(0, 5));
        setAttempts(attemptResult.slice(0, 3));
      } catch (cause) {
        if (!active) return;
        setFetchError((cause as Error).message || "Unable to load your dashboard right now.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [user?.id]);

  if (!user) return <Navigate to="/login" replace />;

  const enrolled = courses.filter((course) => course.is_enrolled);
  const visibleCourses = enrolled.length > 0 ? enrolled : courses;
  const inProgressCount = courses.filter((course) => learningStatus(course) === "In Progress").length;
  const completedCount = courses.filter((course) => learningStatus(course) === "Completed").length;
  const upcomingCount = courses.filter((course) => learningStatus(course) === "Upcoming").length;
  const recentNotifications = notifications.slice(0, 4);
  const statCards = [
    { label: "Enrolled", value: enrolled.length, icon: BookOpen, tone: "emerald" },
    { label: "In progress", value: inProgressCount, icon: Clock3, tone: "amber" },
    { label: "Completed", value: completedCount, icon: CheckCircle2, tone: "green" },
    { label: "Upcoming", value: upcomingCount, icon: CalendarDays, tone: "violet" },
  ];

  return (
    <div className="page-shell dashboard-page">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">Your studio</span>
          <h1>Welcome back, {user.full_name.split(" ")[0]}.</h1>
          <p>Continue your learning journey with live classes, mock tests, and focused revision.</p>
        </div>
        <div className="hero-cta-wrap">
          <Link className="button button-dark" to="/my-learning">Open my learning</Link>
        </div>
      </section>

      {fetchError && (
        <div className="notice error-banner">
          <strong>Unable to load dashboard data</strong>
          <span>{fetchError}</span>
        </div>
      )}

      <section className="stats-grid">
        {statCards.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className={`metric-card metric-card-${tone}`}>
            <div className="metric-icon" aria-hidden="true">
              <Icon size={18} />
            </div>
            <span className="metric-label">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="panel panel-large">
          <div className="panel-header-row">
            <h3>Continue learning</h3>
            <Link to="/my-learning">View all</Link>
          </div>
          {loading ? (
            <div className="skeleton-grid">
              <div className="skeleton-card" />
              <div className="skeleton-card" />
            </div>
          ) : visibleCourses.length === 0 ? (
            <div className="empty-state compact-empty">
              <p>No published courses are available yet.</p>
              <Link className="button button-dark button-small" to="/">Browse courses</Link>
            </div>
          ) : (
            <div className="course-list">
              {visibleCourses.slice(0, 3).map((course) => (
                <div key={course.id} className="mini-course-card">
                  <div>
                    <h4>{course.title}</h4>
                    <p>{course.subject}</p>
                    <span className={`status-chip status-${learningStatus(course).toLowerCase().replace(" ", "-")}`}>
                      {learningStatus(course)}
                    </span>
                    {course.next_topic_title && (
                      <p className="next-lesson-line">Next: {course.next_topic_title}</p>
                    )}
                  </div>
                  <div className="mini-course-meta">
                    <span>{course.progress ?? 0}% complete</span>
                    <Link className="button button-small button-dark" to={course.next_topic_id ? `/course/${course.slug}#topic-${course.next_topic_id}` : `/course/${course.slug}`}>
                      {learningStatus(course) === "Expired" ? "Renew access" : learningStatus(course) === "Upcoming" ? "View course" : "Continue"}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header-row">
            <h3>Recent activity</h3>
            <Link to="/mock-tests">Mock tests</Link>
          </div>
          {attempts.length === 0 ? (
            <p className="muted-copy">No quiz attempts yet. Start a mock test to build momentum.</p>
          ) : (
            <div className="activity-list">
              {attempts.map((attempt) => (
                <div key={attempt.id} className="activity-item">
                  <div>
                    <strong>{attempt.quiz_title}</strong>
                    <span>{attempt.created_at ? new Date(attempt.created_at).toLocaleDateString("en-IN") : "Recently"}</span>
                  </div>
                  <b>{attempt.score}/{attempt.total}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="dashboard-grid secondary-grid">
        <div className="panel">
          <div className="panel-header-row">
            <h3>Recent notifications</h3>
            <Link to="/notifications">View all</Link>
          </div>
          {recentNotifications.length === 0 ? (
            <p className="muted-copy">No notifications yet.</p>
          ) : (
            <div className="notification-compact-list">
              {recentNotifications.map((item) => (
                <div key={item.id} className={`notification-compact ${item.read_at ? "is-read" : "is-unread"}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.message}</small>
                  </div>
                  <span>{item.category}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header-row">
            <h3>Quick access</h3>
          </div>
          <div className="quick-grid">
            <Link to="/ai-lab" className="quick-card">AI Lab</Link>
            <Link to="/study-planner" className="quick-card">Study Planner</Link>
            <Link to="/jrf-strategy" className="quick-card">JRF Strategy</Link>
            <Link to="/mock-tests" className="quick-card">Mock Tests</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

type LearningStatus = "In Progress" | "Completed" | "Upcoming" | "Available" | "Expired";

function learningStatus(course: Course): LearningStatus {
  if (course.learning_status) {
    const labels: Record<NonNullable<Course["learning_status"]>, LearningStatus> = {
      in_progress: "In Progress",
      completed: "Completed",
      upcoming: "Upcoming",
      expired: "Expired",
      available: "Available",
    };
    return labels[course.learning_status];
  }
  const now = Date.now();
  if (course.access_expires_at && new Date(course.access_expires_at).getTime() <= now) {
    return "Completed";
  }
  if (course.launch_at && new Date(course.launch_at).getTime() > now) {
    return "Upcoming";
  }
  if (course.availability_status === "scheduled") {
    return "Upcoming";
  }
  if (course.is_enrolled) {
    return "In Progress";
  }
  return "Available";
}

function MyLearningPage({ user }: { user: User | null }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [activeTab, setActiveTab] = useState<"All" | "In Progress" | "Completed" | "Upcoming">("All");
  const [pageByTab, setPageByTab] = useState<Record<"All" | "In Progress" | "Completed" | "Upcoming", number>>({
    All: 1,
    "In Progress": 1,
    Completed: 1,
    Upcoming: 1,
  });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setFetchError("");
      try {
        const result = await api<Course[]>('/courses/dashboard');
        if (active) setCourses(result);
      } catch (cause) {
        if (!active) return;
        setFetchError((cause as Error).message || "Unable to load My Learning right now.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [user?.id]);

  if (!user) return <Navigate to="/login" replace />;

  const tabs = ["All", "In Progress", "Completed", "Upcoming"] as const;
  const filtered = courses.filter((course) => {
    if (activeTab === "All") return true;
    if (activeTab === "In Progress") return learningStatus(course) === "In Progress";
    if (activeTab === "Completed") return learningStatus(course) === "Completed";
    if (activeTab === "Upcoming") return learningStatus(course) === "Upcoming";
    return true;
  });

  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(pageByTab[activeTab] || 1, 1), totalPages);
  const paginatedCourses = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleTabChange = (tab: "All" | "In Progress" | "Completed" | "Upcoming") => {
    setActiveTab(tab);
    setPageByTab((current) => ({
      ...current,
      [tab]: 1,
    }));
  };

  return (
    <div className="page-shell learning-page">
      <div className="page-header-row">
        <div>
          <span className="eyebrow">My learning</span>
          <h1>Track your momentum</h1>
        </div>
      </div>

      {fetchError && (
        <div className="notice error-banner">
          <strong>Unable to load My Learning</strong>
          <span>{fetchError}</span>
        </div>
      )}

      <div className="tab-row">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`tab-button ${activeTab === tab ? "is-active" : ""}`}
            onClick={() => handleTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="skeleton-grid">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state page-empty-state">
          <p>No courses match this filter yet.</p>
          <Link className="button button-dark" to="/">Browse courses</Link>
        </div>
      ) : (
        <>
          <div className="course-grid">
            {paginatedCourses.map((course) => (
              <article key={course.id} className="course-panel-card">
                <div className="course-panel-top">
                  <span className="status-chip">{learningStatus(course)}</span>
                </div>
                <h3>{course.title}</h3>
                <p>{course.subject}</p>
                <div className="learning-meta">
                  <span>{course.progress ?? 0}% complete</span>
                  {course.access_expires_at && <span>{learningStatus(course) === "Expired" ? "Expired" : `Access until ${new Date(course.access_expires_at).toLocaleDateString("en-IN")}`}</span>}
                </div>
                {course.next_topic_title && learningStatus(course) === "In Progress" && (
                  <div className="next-lesson-panel">
                    <small>Continue where you left off</small>
                    <strong>{course.next_topic_title}</strong>
                    {course.next_module_title && <span>{course.next_module_title}</span>}
                  </div>
                )}
                {course.upcoming_live_class && learningStatus(course) === "In Progress" && (
                  <div className="upcoming-class-line">
                    Live class: {course.upcoming_live_class.title} · {new Date(course.upcoming_live_class.scheduled_at).toLocaleString("en-IN")}
                  </div>
                )}
                {learningStatus(course) === "Expired" ? (
                  <Link className="button button-dark full" to={`/payment/course/${course.slug}`}>Renew access</Link>
                ) : learningStatus(course) === "Upcoming" ? (
                  <Link className="button button-small full" to={`/course/${course.slug}`}>View course</Link>
                ) : (
                  <Link className="button button-dark full" to={course.next_topic_id ? `/course/${course.slug}#topic-${course.next_topic_id}` : `/course/${course.slug}`}>Open course</Link>
                )}
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination-row" aria-label="My learning pagination">
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => setPageByTab((current) => ({ ...current, [activeTab]: Math.max(1, current[activeTab] - 1) }))}
                disabled={currentPage <= 1}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => setPageByTab((current) => ({ ...current, [activeTab]: Math.min(totalPages, current[activeTab] + 1) }))}
                disabled={currentPage >= totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NotificationsPage({ user }: { user: User | null }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await api<Notification[]>('/notifications?include_read=true');
      setItems(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void reload();
  }, [user?.id]);

  if (!user) return <Navigate to="/login" replace />;

  const markRead = async (id: number) => {
    await api(`/notifications/read/${id}`, { method: 'POST' });
    setItems((current) => current.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item));
  };

  const markAllRead = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })));
  };

  const visible = items.filter((item) => filter === 'unread' ? !item.read_at : true);

  return (
    <div className="page-shell notification-page">
      <div className="page-header-row">
        <div>
          <span className="eyebrow">Notifications</span>
          <h1>Latest updates</h1>
        </div>
        <div className="inline-actions">
          <button type="button" className="button button-ghost button-small" onClick={() => setFilter('all')}>All</button>
          <button type="button" className="button button-ghost button-small" onClick={() => setFilter('unread')}>Unread</button>
          <button type="button" className="button button-dark button-small" onClick={() => void markAllRead()}>Mark all as read</button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-grid single">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state page-empty-state">
          <p>No notifications match this view.</p>
        </div>
      ) : (
        <div className="notification-list-full">
          {visible.map((item) => (
            <article key={item.id} className={`notification-item-full ${item.read_at ? "is-read" : "is-unread"}`}>
              <div className="notification-item-row">
                <div>
                  <span className="notification-tag">{item.category}</span>
                  <h3>{item.title}</h3>
                </div>
                <small>{new Date(item.created_at).toLocaleDateString("en-IN")}</small>
              </div>
              <p>{item.message}</p>
              {!item.read_at && (
                <button type="button" className="button button-ghost button-small" onClick={() => void markRead(item.id)}>Mark as read</button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function LearnerShell({
  user,
  onLogout,
}: {
  user: User | null;
  onLogout: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!profileOpen && !mobileOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
        setMobileOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen, mobileOpen]);

  if (user?.role === "admin") return <Navigate to="/admin" replace />;

  const primaryNavItems = [
    { to: "/", label: "Home" },
    { to: "/registered-courses", label: "Registered Courses" },
    { to: "/mock-tests", label: "Mock Tests" },
    { to: "/ai-lab", label: "AI Lab" },
    { to: "/study-planner", label: "Study planner" },
  ];

  const secondaryNavItems = [
    { to: "/jrf-strategy", label: "JRF Strategy" },
    { to: "/about", label: "Mentor" },
    { to: "/contact", label: "Community" },
  ];

  const utilityNavItems = [
    { to: "/question-bank", label: "Question Archive" },
    { to: "/recorded-classes", label: "Recorded Classes" },
    { to: "/live", label: "Live Classes" },
  ];

  return (
    <div className="app-shell learner-shell">
      <header className="topbar">
        <button
          type="button"
          className="mobile-nav-toggle"
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>

        <Link className="brand" to="/">
          <span className="brand-mark">
            <img
              src="/dist/assets/logo.jpeg"
              alt="JRF HUNTERS"
              style={{ width: 34, height: 34, borderRadius: 10 }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </span>
          <span>
            <strong>JRF HUNTERS</strong>
            <small>learning studio</small>
          </span>
        </Link>

        <nav className={`nav-cluster learner-nav ${mobileOpen ? "is-open" : ""}`} aria-label="Main navigation">
          <div className="nav-group nav-group-primary" aria-label="Primary navigation">
            {primaryNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} className="nav-link">{item.label}</NavLink>
            ))}
          </div>
          <div className="nav-group nav-group-secondary" aria-label="Secondary navigation">
            {secondaryNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} className="nav-link">{item.label}</NavLink>
            ))}
          </div>
          <div className="nav-group nav-group-utility" aria-label="Utility navigation">
            {utilityNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} className="nav-link nav-link-utility">{item.label}</NavLink>
            ))}
          </div>
        </nav>

        {user ? (
          <div className="topbar-actions">
            <NotificationCenter user={user} />
            <div className="profile-menu-wrapper" ref={profileRef}>
              <button
                type="button"
                className="profile-chip"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((value) => !value)}
                title="Account menu"
              >
                <span className="avatar">{user.full_name.slice(0, 1).toUpperCase()}</span>
                <span>{user.full_name.split(" ")[0]}</span>
                <ChevronDown size={14} />
              </button>

              {profileOpen && (
                <div className="profile-menu" role="menu">
                  <Link to="/dashboard" role="menuitem" onClick={() => setProfileOpen(false)}>
                    <LayoutDashboard size={16} />
                    <span>Dashboard</span>
                  </Link>
                  <Link to="/my-learning" role="menuitem" onClick={() => setProfileOpen(false)}>
                    <BookOpen size={16} />
                    <span>My Learning</span>
                  </Link>
                  <button type="button" className="profile-menu-signout" onClick={() => { setProfileOpen(false); onLogout(); }}>
                    <LogOut size={16} />
                    <span>Logout</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <Link className="button button-dark button-small" to="/login">
            <LogIn size={15} />
            Student login
          </Link>
        )}
      </header>
      {mobileOpen && <button type="button" className="mobile-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <main>
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

function AdminShell({
  user,
  onLogout,
}: {
  user: User | null;
  onLogout: () => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  if (!user || user.role !== "admin")
    return <Navigate to="/admin/login" replace />;
  return (
    <div className="admin-shell">
      <button
        type="button"
        className="admin-drawer-backdrop"
        aria-label="Close admin navigation"
        onClick={() => setSidebarOpen(false)}
      />
      <aside className={`admin-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <Link className="admin-brand" to="/admin">
          <span className="admin-brand-mark">
            <ShieldCheck size={18} />
          </span>
          <span>
            <strong>JRF HUNTERS</strong>
            <small>admin console</small>
          </span>
        </Link>
        <div className="admin-sidebar-label">CONTROL CENTER</div>
        <nav className="admin-nav">
          <NavLink end to="/admin" onClick={() => setSidebarOpen(false)}>
            <LayoutDashboard size={16} />
            <span>Overview</span>
          </NavLink>
          <NavLink to="/admin/payments" onClick={() => setSidebarOpen(false)}>
            <CheckCircle2 size={16} />
            <span>Payments</span>
          </NavLink>
          <NavLink to="/admin/user-access" onClick={() => setSidebarOpen(false)}>
            <Users size={16} />
            <span>User Access</span>
          </NavLink>
          <NavLink to="/admin/live" onClick={() => setSidebarOpen(false)}>
            <Radio size={16} />
            <span>Live broadcasts</span>
          </NavLink>
          <NavLink to="/admin/recorded-videos" onClick={() => setSidebarOpen(false)}>
            <Play size={16} />
            <span>Recorded Videos</span>
          </NavLink>
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-user">
            <span className="avatar">
              {user.full_name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <b>{user.full_name}</b>
              <small>Administrator</small>
            </span>
          </div>
          <Link className="admin-learner-link" to="/" onClick={() => setSidebarOpen(false)}>
            <ExternalLink size={14} />
            Open learner site
          </Link>
          <button className="admin-logout" onClick={onLogout}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <button
            type="button"
            className="admin-menu-button"
            aria-label="Open admin navigation"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={18} />
          </button>
          <div>
            <span className="admin-kicker">JRF HUNTERS / ADMIN</span>
            <span className="admin-topbar-title">Workspace control</span>
          </div>
          <span className="admin-live-indicator">
            <span />
            System online
          </span>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function AdminUserAccessPage({ user }: { user: User | null }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await api<{ items: any[]; total: number }>('/admin/user-access');
        if (active) setRows(response.items || []);
      } catch (cause) {
        if (!active) return;
        setError((cause as Error).message || 'Unable to load user access records.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [user?.id]);

  if (!user || user.role !== 'admin') return <Navigate to="/admin/login" replace />;

  const filtered = rows.filter((row) => {
    if (!query.trim()) return true;
    const term = query.toLowerCase();
    return row.full_name.toLowerCase().includes(term) || row.email.toLowerCase().includes(term);
  });

  return (
    <div className="admin-access-shell page-shell">
      <div className="admin-access-header">
        <div>
          <span className="eyebrow">ADMIN ACCESS</span>
          <h1>User Access</h1>
          <p className="muted">Manage users, course permissions and manual access.</p>
        </div>
      </div>

      <div className="admin-access-toolbar panel">
        <div className="admin-toolbar-search">
          <Search size={16} />
          <input aria-label="Search users" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" />
        </div>
        <select aria-label="Course filter" defaultValue="all">
          <option value="all">Course</option>
        </select>
        <select aria-label="Access status filter" defaultValue="all">
          <option value="all">Access</option>
        </select>
        <select aria-label="Status filter" defaultValue="all">
          <option value="all">Status</option>
        </select>
      </div>

      {error && <div className="notice error-banner"><strong>Unable to load user access</strong><span>{error}</span></div>}

      {loading ? (
        <div className="empty-state">Loading course access records…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>No matching user access records found.</p></div>
      ) : (
        <div className="admin-access-table panel">
          <div className="admin-access-table-head">
            <span>User</span>
            <span>Courses</span>
            <span>Access</span>
            <span>Last active</span>
            <span className="admin-access-head-action">Action</span>
          </div>

          {filtered.map((row) => {
            const firstCourse = row.course_access[0];
            const lastActive = firstCourse?.granted_at ? new Date(firstCourse.granted_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'No recent activity';
            const accessLabel = firstCourse ? (firstCourse.access_type === 'manual' ? 'Manual' : 'Paid') : 'No access';
            const statusLabel = firstCourse && firstCourse.is_active ? 'Active' : 'Inactive';

            return (
              <article key={row.id} className="admin-access-row">
                <div className="admin-access-user">
                  <div className="admin-user-avatar tiny">{row.full_name.slice(0, 1).toUpperCase()}</div>
                  <div>
                    <strong>{row.full_name}</strong>
                    <small>{row.email}</small>
                  </div>
                </div>

                <div className="admin-access-cell admin-access-course">
                  <span className="admin-cell-label">Courses</span>
                  <strong>{row.manual_access_count || 0}</strong>
                  <small>{firstCourse ? (firstCourse.course_title || `Course #${firstCourse.course_id}`) : 'No course granted'}</small>
                </div>

                <div className="admin-access-cell admin-access-status">
                  <span className="admin-cell-label">Access</span>
                  <span className={`status-chip ${statusLabel === 'Active' ? 'status-live' : 'status-archived'}`}>{statusLabel}</span>
                  <small>{accessLabel}</small>
                </div>

                <div className="admin-access-cell admin-access-activity">
                  <span className="admin-cell-label">Last active</span>
                  <strong>{lastActive}</strong>
                </div>

                <div className="admin-access-actions">
                  <Link className="button button-dark button-small" to={`/admin/user-access/${row.id}`}>Manage access</Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminUserAccessDetailPage({ user }: { user: User | null }) {
  const { userId } = useParams();
  const [detail, setDetail] = useState<any>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<'overview' | 'course-access' | 'activity' | 'login-history'>('overview');
  const [grantForm, setGrantForm] = useState({ course_id: '', live_access_enabled: false, notes: '', expires_at: '' });
  const [revokeTarget, setRevokeTarget] = useState<{ courseId: number; courseTitle: string } | null>(null);

  const reload = async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    try {
      const [detailResponse, courseResponse] = await Promise.all([
        api<any>(`/admin/user-access/${userId}`),
        api<Course[]>('/admin/courses'),
      ]);
      setDetail(detailResponse);
      setCourses(courseResponse || []);
    } catch (cause) {
      setError((cause as Error).message || 'Unable to load this user access record.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void reload();
  }, [user?.id, userId]);

  if (!user || user.role !== 'admin') return <Navigate to="/admin/login" replace />;

  const submitGrant = async (event: FormEvent) => {
    event.preventDefault();
    if (!userId) return;
    const courseId = Number(grantForm.course_id);
    if (!courseId) {
      setError('Choose a course before granting access.');
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(`/admin/user-access/${userId}/grant`, {
        method: 'POST',
        body: JSON.stringify({
          course_id: courseId,
          live_access_enabled: grantForm.live_access_enabled,
          notes: grantForm.notes.trim() || null,
          expires_at: grantForm.expires_at ? new Date(grantForm.expires_at).toISOString() : null,
          access_start: new Date().toISOString(),
          is_active: true,
        }),
      });
      setGrantForm({ course_id: '', live_access_enabled: false, notes: '', expires_at: '' });
      await reload();
    } catch (cause) {
      setError((cause as Error).message || 'Unable to grant course access.');
    } finally {
      setSaving(false);
    }
  };

  const revokeAccess = async (courseId: number) => {
    if (!userId) return;
    setSaving(true);
    try {
      await api(`/admin/user-access/${userId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ course_id: courseId, notes: 'Revoked by admin' }),
      });
      await reload();
    } catch (cause) {
      setError((cause as Error).message || 'Unable to revoke course access.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-shell"><div className="empty-state">Loading user access…</div></div>;
  if (!detail) return <div className="page-shell"><div className="empty-state">User access record not found.</div></div>;

  const summaryCards = [
    { label: 'Courses', value: detail.course_access.length },
    { label: 'Active Access', value: detail.course_access.filter((entry: any) => entry.is_active).length },
    { label: 'Live Access', value: detail.course_access.filter((entry: any) => entry.is_active && entry.live_access_enabled).length },
  ];

  const formatAccessType = (entry: any) => entry.access_type === 'manual' ? 'Manual Admin Access' : 'Paid Enrollment';
  const formatDate = (value: string | null | undefined) => {
    if (!value) return 'Unlimited';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unlimited';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="admin-access-detail-shell">
      <div className="admin-access-detail-topbar">
        <Link className="admin-back-link" to="/admin/user-access">
          <ChevronLeft size={16} />
          <span>User Access</span>
        </Link>
      </div>

      <div className="admin-access-profile-header panel">
        <div className="admin-access-profile-main">
          <div className="admin-user-avatar">{detail.full_name.slice(0, 1).toUpperCase()}</div>
          <div className="admin-access-profile-copy">
            <h1>{detail.full_name}</h1>
            <p>{detail.email} · {detail.role}</p>
          </div>
        </div>

        <div className="admin-access-profile-status">
          <span className={`status-chip ${detail.course_access.some((entry: any) => entry.is_active) ? 'status-live' : 'status-archived'}`}>
            {detail.course_access.some((entry: any) => entry.is_active) ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="admin-access-tabs" role="tablist" aria-label="User access sections">
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'course-access', label: 'Course Access' },
          { key: 'activity', label: 'Activity' },
          { key: 'login-history', label: 'Login History' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`admin-tab-button ${activeTab === tab.key ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="notice error-banner"><strong>Update failed</strong><span>{error}</span></div>}

      {activeTab === 'overview' && (
        <>
          <div className="admin-summary-grid">
            {summaryCards.map((item) => (
              <div key={item.label} className="admin-stat-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="admin-detail-layout">
            <form className="panel admin-form-panel" onSubmit={submitGrant}>
              <div className="panel-header-row compact-header">
                <div>
                  <span className="eyebrow subtle">Permission</span>
                  <h3>Grant Course Access</h3>
                </div>
              </div>
              <p className="muted small-copy">Give this user access to a specific course.</p>

              <div className="admin-form-grid">
                <label className="field-block">
                  <span>Course</span>
                  <select value={grantForm.course_id} onChange={(event) => setGrantForm((current) => ({ ...current, course_id: event.target.value }))}>
                    <option value="">Select a course</option>
                    {courses.map((course) => (
                      <option key={course.id} value={String(course.id)}>{course.title}</option>
                    ))}
                  </select>
                </label>

                <label className="field-block">
                  <span>Expiry date</span>
                  <input type="date" value={grantForm.expires_at} onChange={(event) => setGrantForm((current) => ({ ...current, expires_at: event.target.value }))} />
                </label>
              </div>

              <div className="permission-panel">
                <div className="permission-row">
                  <div>
                    <strong>Course access</strong>
                    <small>Allow access to course content.</small>
                  </div>
                  <span className="permission-state enabled">Enabled</span>
                </div>

                <div className="permission-row permission-toggle-row">
                  <div>
                    <strong>Live classroom access</strong>
                    <small>Allow access to live classes for this course.</small>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle live classroom access"
                    className={`toggle-switch ${grantForm.live_access_enabled ? 'is-on' : ''}`}
                    onClick={() => setGrantForm((current) => ({ ...current, live_access_enabled: !current.live_access_enabled }))}
                  >
                    <span className="toggle-slider" />
                  </button>
                </div>
              </div>

              <label className="field-block">
                <span>Admin note</span>
                <textarea value={grantForm.notes} onChange={(event) => setGrantForm((current) => ({ ...current, notes: event.target.value }))} rows={4} placeholder="Optional reason or offline payment note" />
              </label>

              <div className="admin-form-actions">
                <button type="button" className="button button-ghost" onClick={() => setGrantForm({ course_id: '', live_access_enabled: false, notes: '', expires_at: '' })}>Cancel</button>
                <button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Grant Access'}</button>
              </div>
            </form>

            <div className="panel admin-access-current-panel">
              <div className="panel-header-row compact-header">
                <div>
                  <span className="eyebrow subtle">Current status</span>
                  <h3>Current Course Access</h3>
                </div>
              </div>

              {detail.course_access.length === 0 ? (
                <div className="empty-access-state">
                  <Users size={20} />
                  <strong>No course access</strong>
                  <p>This user currently has no courses assigned.</p>
                  <button type="button" className="button button-dark button-small" onClick={() => setActiveTab('overview')}>Grant Course Access</button>
                </div>
              ) : (
                <div className="access-panel-list">
                  {detail.course_access.map((entry: any) => (
                    <article key={entry.id} className="access-panel-item">
                      <div className="access-panel-head">
                        <div>
                          <span className="access-label">Course</span>
                          <h4>{entry.course_title || `Course #${entry.course_id}`}</h4>
                        </div>
                        <span className={`status-chip ${entry.is_active ? 'status-live' : 'status-archived'}`}>{entry.is_active ? 'Active' : 'Revoked'}</span>
                      </div>

                      <div className="access-metrics">
                        <div className="metric-mini">
                          <span>Access</span>
                          <strong>{formatAccessType(entry)}</strong>
                        </div>
                        <div className="metric-mini">
                          <span>Live classes</span>
                          <strong>{entry.live_access_enabled ? 'Enabled' : 'Disabled'}</strong>
                        </div>
                        <div className="metric-mini">
                          <span>Expiry</span>
                          <strong>{entry.expires_at ? formatDate(entry.expires_at) : 'Unlimited'}</strong>
                        </div>
                      </div>

                      <div className="access-meta-line">
                        <span>Granted: {formatDate(entry.granted_at)}</span>
                        <span>By: {entry.granted_by_name || 'Admin'}</span>
                      </div>

                      <div className="admin-form-actions tight-actions">
                        <button type="button" className="button button-ghost button-small" onClick={() => {
                          setGrantForm({
                            course_id: String(entry.course_id),
                            live_access_enabled: !!entry.live_access_enabled,
                            notes: entry.notes || '',
                            expires_at: entry.expires_at ? new Date(entry.expires_at).toISOString().slice(0, 10) : '',
                          });
                          setActiveTab('overview');
                        }}>
                          Edit access
                        </button>
                        <button type="button" className="button button-dark button-small" onClick={() => setRevokeTarget({ courseId: entry.course_id, courseTitle: entry.course_title || `Course #${entry.course_id}` })}>
                          Revoke access
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'course-access' && (
        <div className="panel admin-table-panel">
          <div className="panel-header-row compact-header">
            <h3>Course Access</h3>
          </div>
          {detail.course_access.length === 0 ? (
            <div className="empty-access-state compact-empty">
              <strong>No course access records</strong>
              <p>This learner does not have any course access grants yet.</p>
            </div>
          ) : (
            <div className="admin-access-grid-table">
              <div className="admin-grid-header">
                <span>Course</span>
                <span>Access type</span>
                <span>Live</span>
                <span>Expiry</span>
                <span>Status</span>
              </div>
              {detail.course_access.map((entry: any) => (
                <div key={entry.id} className="admin-grid-row">
                  <span>{entry.course_title || `Course #${entry.course_id}`}</span>
                  <span>{formatAccessType(entry)}</span>
                  <span>{entry.live_access_enabled ? 'Enabled' : 'Disabled'}</span>
                  <span>{entry.expires_at ? formatDate(entry.expires_at) : 'Unlimited'}</span>
                  <span className={`status-chip ${entry.is_active ? 'status-live' : 'status-archived'}`}>{entry.is_active ? 'Active' : 'Revoked'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="panel">
          <div className="panel-header-row compact-header">
            <h3>Activity</h3>
          </div>
          <div className="timeline">
            {detail.course_access.length > 0 ? detail.course_access.map((entry: any) => (
              <div key={entry.id} className="timeline-item">
                <span className="timeline-dot" />
                <div>
                  <small>{entry.granted_at ? new Date(entry.granted_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Access granted'}</small>
                  <p>{entry.is_active ? 'Course access granted' : 'Course access revoked'} · {entry.course_title || `Course #${entry.course_id}`}</p>
                </div>
              </div>
            )) : (
              <div className="empty-access-state compact-empty">
                <strong>No activity available</strong>
                <p>There are no access events recorded for this user yet.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'login-history' && (
        <div className="panel">
          <div className="panel-header-row compact-header">
            <h3>Login History</h3>
          </div>
          <div className="login-history-table">
            <div className="login-history-header">
              <span>Date / time</span>
              <span>Device</span>
              <span>Browser</span>
              <span>Status</span>
            </div>
            <div className="login-history-row">
              <span>{new Date().toLocaleString('en-IN')}</span>
              <span>Desktop</span>
              <span>Chrome</span>
              <span className="status-chip status-live">Success</span>
            </div>
          </div>
        </div>
      )}

      {revokeTarget && (
        <div className="admin-modal-backdrop" role="dialog" aria-modal="true">
          <div className="admin-confirm-modal panel">
            <div className="panel-header-row compact-header">
              <h3>Revoke course access?</h3>
            </div>
            <p className="muted small-copy">This will remove access to:</p>
            <strong className="modal-course-name">{revokeTarget.courseTitle}</strong>
            <p className="muted small-copy">The user will no longer be able to access this course or its enabled live classes.</p>
            <div className="admin-form-actions">
              <button type="button" className="button button-ghost" onClick={() => setRevokeTarget(null)}>Cancel</button>
              <button
                type="button"
                className="button button-dark"
                onClick={async () => {
                  try {
                    await api(`/admin/user-access/${userId}/revoke`, {
                      method: 'POST',
                      body: JSON.stringify({ course_id: revokeTarget.courseId, notes: 'Revoked by admin' }),
                    });
                    setRevokeTarget(null);
                    await reload();
                  } catch (cause) {
                    setError((cause as Error).message || 'Unable to revoke course access.');
                    setRevokeTarget(null);
                  }
                }}
              >
                Revoke access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TopicLiveOutput({ topic, compact = false }: { topic: Topic; compact?: boolean }) {
  const [query, setQuery] = useState(`Give me a real-time exam-focused explanation of ${topic.title}.`);
  const [answer, setAnswer] = useState<{ answer: string; sources: { resource_id: number; excerpt: string }[]; mode: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      setAnswer(await api(`/rag/ask`, {
        method: "POST",
        body: JSON.stringify({ query: query.trim(), topic_id: topic.id }),
      }));
    } catch (cause) {
      setError((cause as Error).message || "Unable to generate this topic output.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`topic-live-output ${compact ? "topic-live-output-compact" : ""}`}>
      <div className="topic-live-heading">
        <Bot size={14} />
        <span>{compact ? "Live topic output" : "Live topic tutor"}</span>
      </div>
      <form className="topic-live-form" onSubmit={ask}>
        <input
          aria-label={`Ask about ${topic.title}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Ask about ${topic.title}`}
        />
        <button className="button button-small button-dark" type="submit" disabled={loading}>
          {loading ? "Thinking..." : "Ask"}
        </button>
      </form>
      {error && <small className="topic-live-error">{error}</small>}
      {answer && (
        <div className="topic-live-answer">
          <p>{answer.answer}</p>
          <small>{answer.mode === "llm" ? "Generated from this topic's indexed material" : "Retrieved from this topic's indexed material"} · {answer.sources.length} source{answer.sources.length === 1 ? "" : "s"}</small>
        </div>
      )}
    </div>
  );
}

function Home({ user }: { user: User | null }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [pinnedCourse, setPinnedCourse] = useState<Course | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(4);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    setLoading(true);
    const route = user ? "/courses/dashboard" : "/courses";
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (searchTerm.trim()) params.set("search", searchTerm.trim());
    if (subjectFilter && subjectFilter !== "all") params.set("subject", subjectFilter);
    Promise.all([
      api<Course | null>("/courses/pinned").catch(() => null),
      api<PaginatedCourseListResponse>(`${route}?${params.toString()}`),
    ])
      .then(([pinned, response]) => {
        if (!active) return;
        const items = Array.isArray(response.items) ? response.items : [];
        const responseSubjects = Array.isArray(response.subjects) ? response.subjects : [];
        setPinnedCourse(pinned ?? items[0] ?? null);
        setCourses(items.map((item) => ({ ...item, modules: [] })));
        setTotal(Number.isFinite(response.total) ? response.total : items.length);
        setTotalPages(response.total_pages || 1);
        setSubjects(responseSubjects);
        if (subjectFilter !== "all" && !responseSubjects.includes(subjectFilter)) {
          setSubjectFilter("all");
        }
      })
      .catch((cause) => {
        if (active) setError((cause as Error).message || "Unable to load courses right now.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, page, limit, searchTerm, subjectFilter, retry]);

  const featuredCourse = pinnedCourse ?? courses[0] ?? null;
  const defaultCourseSlug = featuredCourse?.slug || "aagaz-batch-paper-1";
  const handlePageChange = (nextPage: number) => setPage(Math.min(Math.max(nextPage, 1), totalPages));

  return (
    <div className="container home-page">
      <section className="hero-card">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="live-pulse" />
            Master Paper 1
          </div>
          <h1>
            Master Paper 1. <br />
            <em>Achieve JRF Success.</em>
          </h1>
          <p>
            India's premier platform for UGC NET & JRF History, providing
            institutional-grade rigour and research-backed pedagogy.
          </p>
          <div className="hero-actions">
            <Link
              className="button button-lime"
              to={`/course/${defaultCourseSlug}`}
            >
              Explore Courses
              <ArrowRight size={17} />
            </Link>
            <Link
              className="button button-dark"
              to={user ? `/course/${defaultCourseSlug}` : "/login"}
            >
              Start Learning
            </Link>
            <Link className="button" to="/mock-tests">
              Take Free Mock Test
            </Link>
          </div>
        </div>
        <div className="hero-orbit">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <div className="orbit-core">
            <Sparkles size={25} />
            <span>
              JRF HUNTERS
              <br />
              <small>NET 2025</small>
            </span>
          </div>
          <div className="orbit-tag tag-top">01 · WATCH</div>
          <div className="orbit-tag tag-bottom">04 · MASTER</div>
        </div>
      </section>
      <section className="metric-row">
        <Metric
          icon={<BookOpen />}
          value={`${total}`}
          label="structured course"
        />
        <Metric icon={<Radio />} value="LIVE" label="Meet classes" />
        <Metric icon={<Bot />} value="RAG" label="syllabus-grounded AI" />
        <Metric icon={<Users />} value="24/7" label="peer learning" />
      </section>
      <FlagshipCard user={user} course={featuredCourse} />
      <DemoVideo />
      <LibraryLaunch />
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {user ? "YOUR BATCH CATALOGUE" : "AVAILABLE BATCHES"}
          </span>
          <h2>
            {user ? "Choose your learning track." : "Find your learning track."}
          </h2>
        </div>
        <span className="muted">
          {user
            ? "Every published batch is shown here"
            : "Published by the admin team"}
        </span>
      </div>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="course-list-controls" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input
            aria-label="Search courses"
            value={searchTerm}
            onChange={(event) => {
              setPage(1);
              setSearchTerm(event.target.value);
            }}
            placeholder="Search courses..."
            style={{ flex: 1, minWidth: 190 }}
          />
          <select
            aria-label="Filter courses by subject"
            value={subjectFilter}
            onChange={(event) => {
              setPage(1);
              setSubjectFilter(event.target.value);
            }}
          >
            <option value="all">All</option>
            {subjects.map((subject) => (
              <option key={subject} value={subject}>{subject}</option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <div className="notice" role="alert">
          <strong>Courses are temporarily unavailable.</strong>
          <span>{error}</span>
          <button className="button button-small button-outline" type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="notice">Loading courses…</div>
      ) : null}
      {!loading && !error && !courses.length ? (
        <div className="notice">
          {searchTerm.trim() || subjectFilter !== "all"
            ? "No courses match your current search or filter."
            : "No courses are currently published."}
        </div>
      ) : null}
      <section className="course-grid">
        {!loading && courses.length ? (
          courses.map((course) => (
            <CourseCard course={course} key={course.id} />
          ))
        ) : null}
        {!loading && !courses.length && !error ? <DemoCourseCard /> : null}
      </section>
      {!loading && totalPages > 1 && (
        <div className="pagination-row" aria-label="Course pagination">
          <button
            className="button button-small button-outline"
            type="button"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            ← Previous
          </button>
          <div className="pagination-pages" aria-live="polite">
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
              <button
                key={pageNumber}
                className={`button button-small ${pageNumber === page ? "button-dark" : "button-outline"}`}
                type="button"
                onClick={() => handlePageChange(pageNumber)}
                disabled={pageNumber === page}
              >
                {pageNumber}
              </button>
            ))}
          </div>
          <button
            className="button button-small button-outline"
            type="button"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
      <section className="lower-grid">
        <div className="panel panel-olive">
          <div className="panel-icon">
            <Bot size={20} />
          </div>
          <span className="eyebrow">AI LAB</span>
          <h3>Your notes, now searchable.</h3>
          <p>
            Ask for a concept breakdown, a comparison, or a 10-question drill.
            Every answer links back to the source chunk.
          </p>
          <Link className="button button-dark" to="/ai-lab">
            Open AI tutor <ArrowRight size={16} />
          </Link>
        </div>
        <div className="panel panel-paper">
          <div className="panel-top">
            <span className="eyebrow">THIS WEEK</span>
            <span className="status-pill">
              <span />
              On track
            </span>
          </div>
          <h3>Study plan</h3>
          <div className="progress-bar">
            <span style={{ width: "68%" }} />
          </div>
          <div className="plan-line">
            <b>68%</b>
            <span>3 of 5 study blocks done</span>
            <strong>+12%</strong>
          </div>
          <div className="mini-list">
            <span>
              <Check size={13} />
              Teaching aptitude
            </span>
            <span>
              <Check size={13} />
              Research methods
            </span>
            <span className="pending">
              <span />
              Data interpretation drill
            </span>
          </div>
        </div>
      </section>
      <Testimonials />
      <NameMarquee />
    </div>
  );
}

function LibraryLaunch() {
  return (
    <section className="library-launch-grid">
      <Link className="library-launch-card" to="/question-bank">
        <span className="library-launch-icon">
          <FileText size={19} />
        </span>
        <span>
          <span className="eyebrow">PREVIOUS-YEAR ARCHIVE</span>
          <h3>Question Bank</h3>
          <p>
            Browse year-wise question files, answer keys and verified source
            documents.
          </p>
        </span>
        <ArrowRight size={16} />
      </Link>
      <Link
        className="library-launch-card library-launch-card-dark"
        to="/recorded-classes"
      >
        <span className="library-launch-icon">
          <Play size={19} />
        </span>
        <span>
          <span className="eyebrow">PREMIUM CLASSROOM</span>
          <h3>Recorded Classes</h3>
          <p>
            Watch the JRF Hunters recordings in date order, starting from Day 1.
          </p>
        </span>
        <ArrowRight size={16} />
      </Link>
    </section>
  );
}

function DemoVideo() {
  return (
    <section className="panel demo-video-panel">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">FREE DEMO</span>
          <h3>See how JRF HUNTERS helps you prepare.</h3>
          <p className="muted">
            Watch the Paper 1 strategy introduction before starting your study
            plan.
          </p>
        </div>
        <Play size={23} />
      </div>
      <div className="demo-video-frame">
        <iframe
          src="https://www.youtube.com/embed/8S4FvfvTMeg?si=EgBDVwbSVpZbkPb_https://www.youtube.com/embed/ToCp3fvbL4I"
          title="UGC NET JRF Paper 1 strategy demo"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    </section>
  );
}

function Metric({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="metric">
      <span className="metric-icon">{icon}</span>
      <span>
        <b>{value}</b>
        <small>{label}</small>
      </span>
    </div>
  );
}
function accessPeriodLabel(course: Course) {
  if (course.access_period === "week") return "7-day access";
  if (course.access_period === "month") return "30-day access";
  if (course.access_period === "quarter") return "90-day access";
  if (course.access_period === "year") return "365-day access";
  if (course.access_period === "lifetime" || course.access_duration_days === 0)
    return "Lifetime access";
  return `${course.access_duration_days} days access`;
}
function batchTypeLabel(course: Course) {
  return course.batch_type === "test_series"
    ? "Test series"
    : course.batch_type === "course"
      ? "Course"
      : "Batch";
}
function CourseCard({ course }: { course: Course }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const topicCount = course.topic_count ?? course.modules.reduce(
    (sum, module) => sum + module.topics.length,
    0,
  );
  const status = course.availability_status;
  const enrolled = status === "enrolled" || course.is_enrolled;
  const unavailable = ["closed", "full"].includes(status || "");
  const imageUrl = course.cover_image_url?.trim();
  const showImage = Boolean(imageUrl && imageUrl !== failedImageUrl);
  return (
    <Link to={`/course/${course.slug}`} className="course-card">
      <div className={`course-art art-sage${showImage ? " has-image" : ""}`}>
        {showImage && imageUrl ? (
          <img
            className="course-art-image"
            src={imageUrl}
            alt=""
            loading="lazy"
            onError={() => setFailedImageUrl(imageUrl)}
          />
        ) : (
          <>
            <span>
              {batchTypeLabel(course).toUpperCase()}
              <br />
              <b>
                {course.subject
                  ? course.subject.split(" ")[0].slice(0, 8).toUpperCase()
                  : "UGC NET"}
              </b>
            </span>
            <span className="art-number">{course.is_featured ? "★" : "01"}</span>
          </>
        )}
      </div>
      <div className="course-card-copy">
        <span className="eyebrow">
          {batchTypeLabel(course).toUpperCase()} · {topicCount || 0} TOPICS
        </span>
        <h3>{course.title}</h3>
        <p>
          {course.description ||
            "Build clarity across the concepts that repeat in the exam."}
        </p>
        <small className="muted">
          {course.price_paise === 0
            ? "Free"
            : `₹${(course.price_paise / 100).toLocaleString("en-IN")}`}{" "}
          · {accessPeriodLabel(course)}
          {course.seats_remaining !== null &&
          course.seats_remaining !== undefined
            ? ` · ${course.seats_remaining} seats left`
            : ""}
        </small>
        {enrolled ? (
          <span className="course-card-status enrolled">
            Enrolled
            {course.access_expires_at
              ? ` · until ${new Date(course.access_expires_at).toLocaleDateString("en-IN")}`
              : ""}
          </span>
        ) : unavailable ? (
          <span className="course-card-status unavailable">
            {status === "full" ? "Batch full" : "Enrollment closed"}
          </span>
        ) : status === "scheduled" ? (
          <span className="course-card-status">Launching soon</span>
        ) : null}
        <div className="card-foot">
          <span>
            {enrolled
              ? "Continue learning"
              : unavailable
                ? "View batch"
                : "Explore batch"}
          </span>
          <ArrowRight size={16} />
        </div>
      </div>
    </Link>
  );
}
function DemoCourseCard() {
  return (
    <div className="course-card demo-card">
      <div className="course-art art-ink">
        <span>
          COMING
          <br />
          <b>ALIVE</b>
        </span>
        <span className="art-number">02</span>
      </div>
      <div className="course-card-copy">
        <span className="eyebrow">YOUR FIRST TRACK</span>
        <h3>Paper 1: Teaching & Research Aptitude</h3>
        <p>
          Start the API to see your published modules, topics, recordings and
          PDFs here.
        </p>
        <div className="card-foot">
          <span>Connect API to begin</span>
          <Radio size={16} />
        </div>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [registering, setRegistering] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [otpPending, setOtpPending] = useState(false);
  const [resetOtpPending, setResetOtpPending] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [remember, setRemember] = useState(true);
  const [legalConsent, setLegalConsent] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resetCooldown, setResetCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const googleToken = params.get("google_token");
    const googleError = params.get("google_error");
    if (googleError) {
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + window.location.search,
      );
      setError(googleError);
      return;
    }
    if (!googleToken) return;
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + window.location.search,
    );
    setGoogleLoading(true);
    storeToken(googleToken, true);
    api<User>("/auth/me")
      .then((currentUser) => {
        onLogin(currentUser);
        const pendingClassId = sessionStorage.getItem("pending_live_class");
        sessionStorage.removeItem("pending_live_class");
        navigate(
          pendingClassId
            ? `/live/${pendingClassId}`
            : currentUser.role === "admin"
              ? "/admin"
              : "/",
        );
      })
      .catch((cause) => {
        clearStoredToken();
        setError((cause as Error).message);
      })
      .finally(() => setGoogleLoading(false));
  }, [navigate, onLogin]);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setResetCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [resetCooldown]);

  const finishLogin = (result: { access_token: string; user: User }) => {
    storeToken(result.access_token, remember);
    onLogin(result.user);
    navigate(result.user.role === "admin" ? "/admin" : "/");
  };

  const sendResetCode = async () => {
    setError("");
    setMessage("");
    if (resetCooldown > 0) return;
    setSubmitting(true);
    try {
      const result = await api<{ message: string; expires_in_seconds: number }>(
        "/auth/request-password-reset",
        {
          method: "POST",
          body: JSON.stringify({ email }),
        },
      );
      setResetOtpPending(true);
      setResetCooldown(60);
      setMessage(
        `${result.message} The code expires in ${Math.round(result.expires_in_seconds / 60)} minutes.`,
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (forgotPassword && !resetOtpPending) {
      await sendResetCode();
      return;
    }
    if (registering && !otpPending && !legalConsent) {
      setError(
        "Please confirm the Terms, Privacy Policy, Refund Rules and Grievance process before continuing.",
      );
      return;
    }
    if (forgotPassword && resetComplete) return;
    if (forgotPassword && newPassword !== confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      if (forgotPassword) {
        const result = await api<{ message: string }>(
          "/auth/confirm-password-reset",
          {
            method: "POST",
            body: JSON.stringify({ email, otp, new_password: newPassword }),
          },
        );
        setResetComplete(true);
        setResetOtpPending(false);
        setOtp("");
        setNewPassword("");
        setConfirmPassword("");
        setMessage(result.message);
        return;
      }
      if (registering && !otpPending) {
        const result = await api<{
          message: string;
          expires_in_seconds: number;
        }>("/auth/request-email-otp", {
          method: "POST",
          body: JSON.stringify({ email, full_name: name, password }),
        });
        setOtpPending(true);
        setMessage(
          `${result.message} The code expires in ${Math.round(result.expires_in_seconds / 60)} minutes.`,
        );
        return;
      }
      if (registering) {
        const result = await api<{ access_token: string; user: User }>(
          "/auth/verify-email-otp",
          {
            method: "POST",
            body: JSON.stringify({ email, otp }),
          },
        );
        finishLogin(result);
        return;
      }
      const result = await api<{ access_token: string; user: User }>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
      );
      finishLogin(result);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetRecovery = (keepEmail = true) => {
    setResetOtpPending(false);
    setResetComplete(false);
    setOtp("");
    setNewPassword("");
    setConfirmPassword("");
    setResetCooldown(0);
    setError("");
    setMessage("");
    if (!keepEmail) setEmail("");
  };

  const switchMode = () => {
    if (forgotPassword) {
      setForgotPassword(false);
      setRegistering(false);
    } else {
      setRegistering((value) => !value);
    }
    resetRecovery();
    setOtpPending(false);
    setPassword("");
    setName("");
    setLegalConsent(false);
  };

  const startForgotPassword = () => {
    setForgotPassword(true);
    setRegistering(false);
    setOtpPending(false);
    setResetComplete(false);
    setOtp("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setMessage("");
  };

  const passwordStrength =
    newPassword.length < 8
      ? "Too short"
      : newPassword.length >= 12 &&
          /[A-Z]/.test(newPassword) &&
          /\d/.test(newPassword)
        ? "Strong password"
        : "Good password";
  const recoveryStep = resetComplete ? 3 : resetOtpPending ? 2 : 1;
  const pendingCode = registering ? otpPending : resetOtpPending;
  const heading = forgotPassword
    ? resetComplete
      ? "Password updated"
      : resetOtpPending
        ? "Verify and create a new password"
        : "Recover your account"
    : registering
      ? otpPending
        ? "Check your email"
        : "Create your account"
      : "Sign in to learn";
  const description = forgotPassword
    ? resetComplete
      ? "Your account is secure again. Use the new password the next time you sign in."
      : resetOtpPending
        ? `We sent a one-time code to ${email}. It expires soon.`
        : "Enter the email connected to your JRF HUNTERS account and we’ll guide you through a secure reset."
    : registering
      ? otpPending
        ? `Enter the 6-digit code sent to ${email}.`
        : "Verify your email before your account is created."
      : "Continue exactly where your last study block ended.";

  return (
    <div className="auth-screen student-auth-screen">
      <div className="auth-topline">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <img
              src="/dist/assets/logo.jpeg"
              alt="JRF HUNTERS"
              style={{ width: 34, height: 34, borderRadius: 10 }}
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          </span>
          <span>
            <strong>JRF HUNTERS</strong>
            <small>learning studio</small>
          </span>
        </Link>
      </div>
      <div className="auth-wrap">
        <div className="auth-aside">
          <span className="eyebrow">
            {forgotPassword ? "SECURE RECOVERY" : "STUDENT SPACE"}
          </span>
          <h1>
            {forgotPassword ? (
              <>
                Back to
                <br />
                <em>your rhythm.</em>
              </>
            ) : (
              <>
                The quiet edge
                <br />
                <em>is consistency.</em>
              </>
            )}
          </h1>
          <p>
            {forgotPassword
              ? "A verified email is the safest way to regain access without interrupting your preparation."
              : "Keep your live classes, revision loops and questions in one place."}
          </p>
          <div className="auth-note">
            <ShieldCheck size={16} />
            <span>
              {forgotPassword ? (
                <>
                  Protected account recovery
                  <br />
                  <b>Private · verified · one-time</b>
                </>
              ) : (
                <>
                  Your personal preparation room
                  <br />
                  <b>Learn · practise · improve</b>
                </>
              )}
            </span>
          </div>
        </div>
        <form
          className={`auth-card ${forgotPassword ? "auth-card-recovery" : ""}`}
          onSubmit={submit}
        >
          <div className="auth-card-heading">
            <span className="eyebrow">
              {forgotPassword
                ? "ACCOUNT RECOVERY"
                : registering
                  ? "NEW LEARNER"
                  : "WELCOME BACK"}
            </span>
            <h2>{heading}</h2>
            <p className="muted">{description}</p>
          </div>
          {forgotPassword && !resetComplete && (
            <div className="auth-recovery-panel">
              <div className="auth-recovery-summary">
                <span className="auth-recovery-icon">
                  <LockKeyhole size={18} />
                </span>
                <span>
                  <b>Secure reset</b>
                  <small>
                    We never display or store your recovery code in the browser.
                  </small>
                </span>
              </div>
              <div
                className="auth-stepper"
                aria-label="Password recovery progress"
              >
                {[
                  [1, "Email"],
                  [2, "Verify"],
                  [3, "Complete"],
                ].map(([step, label]) => (
                  <span
                    className={
                      recoveryStep >= Number(step)
                        ? "auth-step active"
                        : "auth-step"
                    }
                    key={String(label)}
                  >
                    <i>
                      {recoveryStep > Number(step) ? <Check size={12} /> : step}
                    </i>
                    <small>{label}</small>
                  </span>
                ))}
              </div>
            </div>
          )}
          {resetComplete ? (
            <div className="auth-success-state">
              <span className="auth-success-icon">
                <CheckCircle2 size={28} />
              </span>
              <h3>Password changed successfully</h3>
              <p>
                {message || "Your password has been updated."} You can now sign
                in with it.
              </p>
              <button
                className="button button-dark full"
                type="button"
                onClick={() => {
                  setForgotPassword(false);
                  setResetComplete(false);
                  setMessage("");
                  setPassword("");
                }}
              >
                Continue to sign in <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <>
              {!registering && !forgotPassword && (
                <>
                  <a
                    className="button button-dark full"
                    href={`${API_URL}/auth/google/login`}
                    onClick={() => setGoogleLoading(true)}
                  >
                    {googleLoading ? "Opening Google…" : "Continue with Google"}
                    <ArrowRight size={16} />
                  </a>
                  <p className="auth-inline-note">
                    <Mail size={13} /> Google sign-in is required to join
                    restricted live classes.
                  </p>
                </>
              )}
              {registering && !otpPending && (
                <label>
                  Name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    minLength={2}
                    autoComplete="name"
                  />
                </label>
              )}
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  readOnly={pendingCode}
                  autoComplete="email"
                />
              </label>
              {pendingCode && (
                <label>
                  {registering
                    ? "Email verification code"
                    : "Password reset code"}
                  <input
                    className="auth-code-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(event) =>
                      setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="Enter 6 digits"
                    required
                    autoFocus
                  />
                </label>
              )}
              {forgotPassword && resetOtpPending && (
                <>
                  <div className="password-field">
                    <label>New password</label>
                    <span className="password-field-control">
                      <input
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                      />
                      <button
                        type="button"
                        aria-label={
                          showNewPassword
                            ? "Hide new password"
                            : "Show new password"
                        }
                        onClick={() => setShowNewPassword((value) => !value)}
                      >
                        {showNewPassword ? (
                          <EyeOff size={15} />
                        ) : (
                          <Eye size={15} />
                        )}
                      </button>
                    </span>
                  </div>
                  <div
                    className={`password-strength ${passwordStrength === "Strong password" ? "strong" : ""}`}
                  >
                    <span>
                      <i />
                      <i />
                      <i />
                    </span>
                    <small>
                      {passwordStrength} · Use a mix of letters and numbers.
                    </small>
                  </div>
                  <div className="password-field">
                    <label>Confirm new password</label>
                    <span className="password-field-control">
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
                        required
                        minLength={8}
                        autoComplete="new-password"
                        placeholder="Re-enter your password"
                      />
                      <button
                        type="button"
                        aria-label={
                          showConfirmPassword
                            ? "Hide confirmation"
                            : "Show confirmation"
                        }
                        onClick={() =>
                          setShowConfirmPassword((value) => !value)
                        }
                      >
                        {showConfirmPassword ? (
                          <EyeOff size={15} />
                        ) : (
                          <Eye size={15} />
                        )}
                      </button>
                    </span>
                  </div>
                  {confirmPassword && confirmPassword !== newPassword && (
                    <small className="auth-field-error">
                      Passwords do not match yet.
                    </small>
                  )}
                </>
              )}
              {!forgotPassword && (!registering || !otpPending) && (
                <div className="password-field">
                  <label>Password</label>
                  <span className="password-field-control">
                    <input
                      type={showLoginPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                      autoComplete={
                        registering ? "new-password" : "current-password"
                      }
                    />
                    <button
                      type="button"
                      className="password-eye-btn"
                      aria-label={
                        showLoginPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowLoginPassword((value) => !value)}
                    >
                      {showLoginPassword ? (
                        <EyeOff size={15} />
                      ) : (
                        <Eye size={15} />
                      )}
                    </button>
                  </span>
                </div>
              )}
              {registering && !otpPending && (
                <label className="consent-field">
                  <input
                    type="checkbox"
                    checked={legalConsent}
                    onChange={(event) => setLegalConsent(event.target.checked)}
                    required
                  />
                  <span>
                    I agree to the{" "}
                    <Link to="/terms" target="_blank">
                      Terms & Conditions
                    </Link>
                    ,{" "}
                    <Link to="/privacy" target="_blank">
                      Privacy Policy
                    </Link>
                    ,{" "}
                    <Link to="/refunds" target="_blank">
                      Refund Rules
                    </Link>{" "}
                    and{" "}
                    <Link to="/grievances" target="_blank">
                      Grievance process
                    </Link>
                    .
                  </span>
                </label>
              )}
              {!forgotPassword && (
                <label className="remember-field">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />{" "}
                  Remember me on this device
                </label>
              )}
              {message && (
                <div className="auth-notice" role="status" aria-live="polite">
                  <Mail size={14} />
                  <span>{message}</span>
                </div>
              )}
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="button button-dark full auth-submit"
                type="submit"
                disabled={submitting}
              >
                {submitting
                  ? "Please wait…"
                  : forgotPassword
                    ? resetOtpPending
                      ? "Update password"
                      : "Send secure reset code"
                    : registering
                      ? otpPending
                        ? "Verify email and create account"
                        : "Send verification code"
                      : "Enter student space"}
                <ArrowRight size={16} />
              </button>
              {forgotPassword && resetOtpPending && (
                <div className="auth-recovery-actions">
                  <button
                    className="button-link"
                    type="button"
                    disabled={resetCooldown > 0 || submitting}
                    onClick={() => void sendResetCode()}
                  >
                    {resetCooldown > 0
                      ? `Resend code in ${resetCooldown}s`
                      : "Resend code"}
                  </button>
                  <button
                    className="button-link"
                    type="button"
                    onClick={() => resetRecovery(false)}
                  >
                    Use a different email
                  </button>
                </div>
              )}
              {forgotPassword ? (
                <button
                  className="button-link auth-back-link"
                  type="button"
                  onClick={switchMode}
                >
                  Back to sign in
                </button>
              ) : (
                <>
                  {!registering && (
                    <button
                      className="button-link auth-forgot-link"
                      type="button"
                      onClick={startForgotPassword}
                    >
                      Forgot password?
                    </button>
                  )}
                  <button
                    className="button-link"
                    type="button"
                    onClick={switchMode}
                  >
                    {registering
                      ? "Already have an account? Sign in"
                      : "New here? Create an account"}
                  </button>
                </>
              )}
            </>
          )}
        </form>
      </div>
      <div className="auth-footer">JRF HUNTERS student access · JRF preparation</div>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("jrfhunters@gmail.com");
  const [password, setPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [showAdminNewPassword, setShowAdminNewPassword] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [resetOtpPending, setResetOtpPending] = useState(false);
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      if (forgotPassword && !resetOtpPending) {
        const result = await api<{
          message: string;
          expires_in_seconds: number;
        }>("/auth/request-password-reset", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        setResetOtpPending(true);
        setMessage(
          `${result.message} The code expires in ${Math.round(result.expires_in_seconds / 60)} minutes.`,
        );
        return;
      }
      if (forgotPassword) {
        const result = await api<{ message: string }>(
          "/auth/confirm-password-reset",
          {
            method: "POST",
            body: JSON.stringify({ email, otp, new_password: newPassword }),
          },
        );
        setForgotPassword(false);
        setResetOtpPending(false);
        setOtp("");
        setNewPassword("");
        setMessage(result.message);
        return;
      }
      const result = await api<{ access_token: string; user: User }>(
        "/auth/admin-login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      storeToken(result.access_token, true);
      onLogin(result.user);
      navigate("/admin");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <div className="admin-auth-screen">
      <div className="admin-auth-grid">
        <div className="admin-auth-copy">
          <Link className="admin-brand admin-auth-brand" to="/admin/login">
            <span className="admin-brand-mark">
              <ShieldCheck size={18} />
            </span>
            <span>
              <strong>JRF HUNTERS</strong>
              <small>admin console</small>
            </span>
          </Link>
          <span className="admin-auth-kicker">PRIVATE WORKSPACE</span>
          <h1>
            Run the learning
            <br />
            <em>studio with clarity.</em>
          </h1>
          <p>
            Manage courses, materials and live broadcasts from one focused
            control room.
          </p>
          <div className="admin-auth-points">
            <span>
              <ShieldCheck size={15} />
              Role-protected access
            </span>
            <span>
              <Radio size={15} />
              Broadcast controls
            </span>
            <span>
              <FileText size={15} />
              Content publishing
            </span>
          </div>
        </div>
        <form className="admin-auth-card" onSubmit={submit}>
          <div className="admin-auth-card-icon">
            <ShieldCheck size={20} />
          </div>
          <span className="admin-auth-kicker">
            {forgotPassword ? "ACCOUNT RECOVERY" : "ADMINISTRATOR SIGN IN"}
          </span>
          <h2>
            {forgotPassword
              ? resetOtpPending
                ? "Set a new password."
                : "Forgot password?"
              : "Welcome back."}
          </h2>
          <p>
            {forgotPassword
              ? resetOtpPending
                ? "Enter the email code and choose a new password."
                : "We will send a one-time code to the administrator email."
              : "Use your administrator credentials to open the control center."}
          </p>
          <label>
            Admin email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              readOnly={resetOtpPending}
            />
          </label>
          {forgotPassword && resetOtpPending && (
            <label>
              Reset code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="6-digit code"
                required
              />
            </label>
          )}
          {forgotPassword && resetOtpPending && (
            <label>
              New password
              <span className="password-field-control">
                <input
                  type={showAdminNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="password-eye-btn"
                  aria-label={showAdminNewPassword ? "Hide new password" : "Show new password"}
                  onClick={() => setShowAdminNewPassword((value) => !value)}
                >
                  {showAdminNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </label>
          )}
          {!forgotPassword && (
            <label>
              Password
              <span className="password-field-control">
                <input
                  type={showAdminPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-eye-btn"
                  aria-label={showAdminPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowAdminPassword((value) => !value)}
                >
                  {showAdminPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </label>
          )}
          {message && <div className="admin-form-message">{message}</div>}
          {error && <div className="admin-form-error">{error}</div>}
          <button className="button button-lime full" type="submit">
            {forgotPassword
              ? resetOtpPending
                ? "Reset password"
                : "Send reset code"
              : "Open admin console"}{" "}
            <ArrowRight size={16} />
          </button>
          {forgotPassword && resetOtpPending && (
            <button
              className="button-link"
              type="button"
              onClick={() => {
                setResetOtpPending(false);
                setOtp("");
                setNewPassword("");
                setMessage("");
              }}
            >
              Request a new code
            </button>
          )}
          {forgotPassword ? (
            <button
              className="button-link"
              type="button"
              onClick={() => {
                setForgotPassword(false);
                setResetOtpPending(false);
                setOtp("");
                setNewPassword("");
                setMessage("");
                setError("");
              }}
            >
              Back to admin sign in
            </button>
          ) : (
            <button
              className="button-link"
              type="button"
              onClick={() => {
                setForgotPassword(true);
                setError("");
                setMessage("");
              }}
            >
              Forgot administrator password?
            </button>
          )}
          <a className="admin-back-link" href={learnerAppUrl}>
            Sign in as a student <ArrowRight size={14} />
          </a>
        </form>
      </div>
      <div className="admin-auth-footer">
        <span>JRF HUNTERS / ADMIN</span>
        <span>Authorized personnel only</span>
      </div>
    </div>
  );
}

function CoursePage({ user }: { user: User | null }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [modulePageData, setModulePageData] = useState<{
    items: Module[];
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  } | null>(null);
  const [modulePage, setModulePage] = useState(1);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [moduleSearch, setModuleSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<"all" | "with-resources">("all");
  const [moduleTypeFilter, setModuleTypeFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [liveRefresh, setLiveRefresh] = useState(0);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    void api<Course>(`/courses/${slug}`)
      .then((result) => {
        if (active) setCourse(result);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    if (user) {
      void api<Course[]>("/courses/dashboard")
        .then((items) => {
          const state = items.find((item) => item.slug === slug);
          if (active && state)
            setCourse((current) =>
              current ? { ...current, ...state } : state,
            );
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [slug, user]);

  useEffect(() => {
    if (!course?.id) return;
    let active = true;
    setModuleLoading(true);
    void api<{
      items: Module[];
      page: number;
      limit: number;
      total: number;
      total_pages: number;
    }>(`/courses/${course.id}/modules?page=${modulePage}&limit=10`)
      .then((result) => {
        if (active) setModulePageData(result);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      })
      .finally(() => {
        if (active) setModuleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [course?.id, modulePage]);

  if (!course)
    return (
      <div className="container">
        <div className="empty-state">{message || "Loading course…"}</div>
      </div>
    );

  const enroll = () => {
    if (!user) {
      setMessage("Sign in to save progress and enroll.");
      return;
    }
    navigate(`/payment/course/${course.slug}`);
  };
  const canAccess = course.is_enrolled === true || user?.role === "admin";
  const launchDate = course.launch_at ? new Date(course.launch_at) : null;
  const launchMessage =
    launchDate && launchDate.getTime() > Date.now()
      ? `Launches ${launchDate.toLocaleString("en-IN")}`
      : course.enrollment_deadline &&
          new Date(course.enrollment_deadline).getTime() > Date.now()
        ? `Enrollment closes ${new Date(course.enrollment_deadline).toLocaleString("en-IN")}`
        : "";
  const hasOffer = Boolean(
    course.offer_enabled &&
    course.offer_label?.trim() &&
    course.offer_price_paise != null &&
    course.offer_price_paise > 0 &&
    course.offer_price_paise < course.price_paise,
  );
  const totalModuleTopics = course.modules.reduce(
    (sum, item) => sum + item.topics.length,
    0,
  );
  const visibleModules = modulePageData?.items ?? [];
  const normalizedModuleSearch = moduleSearch.trim().toLowerCase();
  const filteredVisibleModules = visibleModules.flatMap((module) => {
    const searchableText = [
      module.title,
      ...module.topics.flatMap((topic) => [topic.title, ...topic.resources.map((resource) => resource.title), ...topic.resources.map((resource) => resource.original_filename)]),
    ].join(" ").toLowerCase();
    const moduleMatches = !normalizedModuleSearch || searchableText.includes(normalizedModuleSearch);
    const topics = module.topics.flatMap((topic) => {
      const topicMatches = !normalizedModuleSearch || topic.title.toLowerCase().includes(normalizedModuleSearch);
      const resources = topic.resources.filter((resource) => {
        const typeMatches = resourceMatchesType(resource, moduleTypeFilter);
        const fileMatches = !normalizedModuleSearch || topicMatches || `${resource.title} ${resource.original_filename}`.toLowerCase().includes(normalizedModuleSearch);
        return typeMatches && fileMatches;
      });
      return topicMatches || resources.length ? [{ ...topic, resources }] : [];
    });
    const resourceCount = topics.reduce((total, topic) => total + topic.resources.length, 0);
    return moduleMatches && (moduleFilter === "all" || resourceCount > 0) && (moduleTypeFilter === "all" || resourceCount > 0)
      ? [{ ...module, topics }]
      : [];
  });
  const pageStart = modulePageData
    ? (modulePageData.page - 1) * modulePageData.limit + 1
    : 0;
  const pageEnd = modulePageData
    ? Math.min(modulePageData.page * modulePageData.limit, modulePageData.total)
    : 0;

  return (
    <div className="container course-page">
      <div className="course-hero">
        <div>
          <span className="eyebrow">
            {batchTypeLabel(course).toUpperCase()} · {course.subject || "UGC NET"}
          </span>
          <h1>{course.title}</h1>
          <p>{course.description}</p>
          <small className="muted">
            {course.price_paise === 0 ? "Free enrollment" : hasOffer
              ? `${course.offer_label} · ₹${((course.offer_price_paise || 0) / 100).toLocaleString("en-IN")} (was ₹${(course.price_paise / 100).toLocaleString("en-IN")}, save ₹${((course.price_paise - (course.offer_price_paise || 0)) / 100).toLocaleString("en-IN")})`
              : `₹${(course.price_paise / 100).toLocaleString("en-IN")}`} · {accessPeriodLabel(course)}
            {course.max_students ? ` · ${course.max_students} seats` : ""}
            {launchMessage ? ` · ${launchMessage}` : ""}
          </small>
          {canAccess ? (
            <span className="inline-message">Access active</span>
          ) : (
            <button className="button button-lime" onClick={enroll}>
              {course.price_paise === 0 ? "Start free enrollment" : "Enroll now"}{" "}
              <ArrowRight size={16} />
            </button>
          )}
          {message && <span className="inline-message">{message}</span>}
        </div>
        <div className="course-stamp">
          <Library size={24} />
          <b>{course.modules.length || 1}</b>
          <span>modules</span>
        </div>
      </div>
      <CourseLiveClasses
        key={liveRefresh}
        courseId={course.id}
        user={user}
        courseAccess={canAccess}
      />
      <div className="course-content">
        <div>
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">THE ROADMAP</span>
              <h2>Modules & topics</h2>
            </div>
            <span className="muted">{totalModuleTopics} lessons mapped</span>
          </div>

          {moduleLoading ? (
            <div className="empty-state">Loading modules…</div>
          ) : visibleModules.length ? (
            <>
              <div className="course-module-tools" role="search">
                <div className="course-module-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={moduleSearch}
                    onChange={(event) => setModuleSearch(event.target.value)}
                    placeholder="Search modules, topics or files"
                    aria-label="Search modules, topics or files"
                  />
                </div>
                <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value as typeof moduleFilter)} aria-label="Filter modules">
                  <option value="all">All modules</option>
                  <option value="with-resources">With resources</option>
                </select>
                <select value={moduleTypeFilter} onChange={(event) => setModuleTypeFilter(event.target.value)} aria-label="Filter files by type">
                  <option value="all">All file types</option>
                  <option value="pdf">PDF</option>
                  <option value="document">Documents</option>
                  <option value="presentation">Presentations</option>
                  <option value="spreadsheet">Spreadsheets</option>
                  <option value="image">Images</option>
                  <option value="audio">Audio</option>
                  <option value="video">Video</option>
                </select>
              </div>
              <div className="module-card-list">
                {filteredVisibleModules.map((module) => (
                  <ModuleBlock
                    key={module.id}
                    module={module}
                    courseAccess={canAccess}
                    completedTopicIds={course.completed_topic_ids || []}
                  />
                ))}
              </div>

              {!filteredVisibleModules.length && (
                <div className="empty-state">No modules, topics or files match your filter.</div>
              )}

              {modulePageData && modulePageData.total_pages > 1 && (
                <div className="module-pagination-wrap">
                  <div className="module-pagination-row">
                    <button
                      type="button"
                      className="button button-small"
                      disabled={modulePage === 1}
                      onClick={() => setModulePage((current) => Math.max(1, current - 1))}
                    >
                      <ChevronLeft size={14} /> Previous
                    </button>

                    <div className="module-page-numbers">
                      {Array.from({ length: modulePageData.total_pages }, (_, index) => index + 1).map((pageNumber) => (
                        <button
                          key={pageNumber}
                          type="button"
                          className={pageNumber === modulePage ? "module-page-pill module-page-pill-active" : "module-page-pill"}
                          onClick={() => setModulePage(pageNumber)}
                        >
                          {pageNumber}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="button button-small"
                      disabled={modulePage === modulePageData.total_pages}
                      onClick={() => setModulePage((current) => Math.min(modulePageData.total_pages, current + 1))}
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </div>

                  <div className="module-page-status">
                    Showing modules {pageStart}–{pageEnd} of {modulePageData.total}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">No modules published yet.</div>
          )}
        </div>
        <aside className="side-panel">
          <span className="eyebrow">SMART REVISION</span>
          <h3>Make this track yours.</h3>
          <p>
            Use the AI Lab to ask questions against your notes, then generate a
            topic quiz from the same material.
          </p>
          <Link to="/ai-lab" className="button button-dark full">
            Ask the tutor <Bot size={16} />
          </Link>
          <div className="side-divider" />
          <span className="eyebrow">RESOURCE TYPES</span>
          <div className="legend">
            <span>
              <FileText size={14} />
              Notes & PDFs
            </span>
            <span>
              <Play size={16} />
              Recordings
            </span>
            <span>
              <Sparkles size={16} />
              AI quizzes
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PaymentPage({ user }: { user: User | null }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [access, setAccess] = useState<PremiumAccess | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!slug || !user) return;
    let active = true;
    void Promise.all([
      api<Course>(`/courses/${slug}`),
      api<Course[]>("/courses/dashboard"),
      api<PremiumAccess>("/payments/status"),
    ])
      .then(([result, items, paymentStatus]) => {
        if (!active) return;
        const state = items.find((item) => item.slug === slug);
        setCourse(state ? { ...result, ...state } : result);
        setAccess(paymentStatus);
      })
      .catch((cause) => {
        if (active) setMessage((cause as Error).message);
      });
    return () => {
      active = false;
    };
  }, [slug, user]);

  useEffect(() => {
    if (!slug || !user || access?.premium_access) return;
    const timer = window.setInterval(() => {
      void Promise.all([
        api<PremiumAccess>("/payments/status"),
        api<Course[]>("/courses/dashboard"),
      ])
        .then(([result, items]) => {
          setAccess(result);
          if (
            result.premium_access ||
            items.some((item) => item.slug === slug && item.is_enrolled)
          )
            navigate(`/course/${slug}`, { replace: true });
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [access?.premium_access, navigate, slug, user]);

  if (!user)
    return (
      <div className="container">
        <div className="empty-state">
          <LogIn size={26} />
          <h2>Sign in to continue.</h2>
          <p>Sign in before opening the secure payment page.</p>
          <Link to="/login" className="button button-dark">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  if (!course || !access)
    return (
      <div className="container">
        <div className="empty-state">
          {message || "Checking payment access…"}
        </div>
      </div>
    );
  if (course.is_enrolled)
    return <Navigate to={`/course/${course.slug}`} replace />;

  const pay = () => {
    setBusy(true);
    setMessage("");
    void startPremiumCheckout(
      () => {
        setBusy(false);
        navigate("/registered-courses", { replace: true });
      },
      (error) => {
        setBusy(false);
        setMessage(error);
      },
      { course_id: course.id },
    );
  };

  const retryPayment = () => {
    setBusy(false);
    setMessage("");
    navigate(`/payment/course/${course.slug}`, { replace: true });
  };

  const freeCourse = course.price_paise === 0;
  const notConfigured = Boolean(
    !freeCourse && access && !access.razorpay_configured && !access.mock_mode,
  );
  const testMode = access?.razorpay_mode === "test";
  const paymentUnavailable = !freeCourse && notConfigured;
  return (
    <div className="container payment-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SECURE CHECKOUT</span>
          <h1>Complete your enrollment.</h1>
          <p>
            {freeCourse
              ? "Start your free enrollment."
              : "Payment is processed by Razorpay. Your course access is activated only after server-side payment verification."}
          </p>
        </div>
        <button
          className="button button-small"
          type="button"
          onClick={() => navigate(`/course/${course.slug}`)}
        >
          <ChevronLeft size={15} /> Back to course
        </button>
      </div>
      <section className="payment-card panel panel-paper">
        <div>
          <span className="eyebrow">COURSE ENROLLMENT</span>
          <h2>{course.title}</h2>
          <p>{course.subject}</p>
        </div>
        <div className="payment-price">
          <small>Amount</small>
          <b>
            {freeCourse
              ? "Free"
              : `₹${(course.price_paise / 100).toLocaleString("en-IN")}`}
          </b>
          <span>
            {course.access_duration_days === 0
              ? "Lifetime access"
              : `${course.access_duration_days} days access`}
          </span>
        </div>
        {notConfigured && (
          <div className="notice">
            Razorpay is not configured. Add the key ID and secret to{" "}
            <code>backend/.env</code>, then restart the backend.
          </div>
        )}
        {testMode && !freeCourse && (
          <div className="notice">
            Razorpay test mode is active. Replace <code>rzp_test_...</code> with
            a live key before accepting real GPay payments.
          </div>
        )}
        <div className="payment-actions">
          <button
            className="button button-lime"
            type="button"
            disabled={busy || paymentUnavailable}
            onClick={pay}
          >
            {busy
              ? "Opening Razorpay…"
              : paymentUnavailable
                ? "Live key required"
                : freeCourse
                  ? "Start free enrollment"
                  : testMode
                    ? "Proceed to test payment"
                    : "Proceed to payment"}{" "}
            {!paymentUnavailable && <ArrowRight size={16} />}
          </button>
          {message && (
            <>
              <span className="payment-message">{message}</span>
              <button
                className="button button-small"
                type="button"
                onClick={retryPayment}
              >
                Retry payment
              </button>
            </>
          )}
        </div>
        <p className="payment-legal-copy">
          By continuing, you agree to our{" "}
          <Link to="/terms">Terms & Conditions</Link>,{" "}
          <Link to="/privacy">Privacy Policy</Link> and{" "}
          <Link to="/refunds">Refund Rules</Link>. Need help?{" "}
          <Link to="/contact">Contact support</Link>.
        </p>
      </section>
    </div>
  );
}

function RegisteredCoursesPage({ user }: { user: User | null }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const items = await api<Course[]>("/courses/dashboard");
      const enrolled = items.filter((course) => course.is_enrolled);
      const deduped = Array.from(new Map(enrolled.map((course) => [course.id, course])).values());
      setCourses(deduped);
    } catch (cause) {
      setError((cause as Error).message || "Unable to load your registered courses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void load();
  }, [user?.id]);

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="container page-shell registered-page">
      <section className="section-heading registered-page-header">
        <div>
          <span className="eyebrow">YOUR LEARNING</span>
          <h1>Registered Courses</h1>
          <p>Continue learning from your active courses.</p>
        </div>
        <div className="registered-summary-pill">
          <strong>{courses.length}</strong>
          <span>{courses.length === 1 ? "Active Course" : "Active Courses"}</span>
        </div>
      </section>

      {loading ? (
        <div className="empty-state">Loading your registered courses…</div>
      ) : error ? (
        <div className="empty-state">
          <h2>Unable to load your registered courses.</h2>
          <p>{error}</p>
          <button className="button button-dark" type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : courses.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={28} />
          <h2>No registered courses</h2>
          <p>You have not registered for any courses yet.</p>
          <Link className="button button-dark" to="/courses">Browse Courses</Link>
        </div>
      ) : (
        <div className="registered-courses-grid">
          {courses.map((course) => {
            const progress = Math.max(0, Math.min(100, Number(course.progress ?? 0)));
            const isAdminGranted = course.enrollment_source === "admin" || course.enrollment_source === "manual";
            const isLiveEnabled = Boolean(course.live_access_enabled);

            return (
              <article className="registered-course-card" key={course.id}>
                <div className="registered-course-card__top">
                  <span className="registered-course-status">
                    <span className="registered-course-status__dot" aria-hidden="true" />
                    Active
                  </span>
                </div>

                <div className="registered-course-card__body">
                  <h3>{course.title}</h3>
                  <p>{course.description || "Continue your learning journey with this course."}</p>

                  <div className="registered-progress-block">
                    <div className="registered-progress-meta">
                      <span>Your progress</span>
                      <strong>{progress}%</strong>
                    </div>
                    <div className="registered-progress-bar" aria-label={`${progress}% complete`}>
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <div className="registered-badges">
                    {isAdminGranted && <span className="registered-badge">Admin Granted</span>}
                    {!isAdminGranted && <span className="registered-badge registered-badge--neutral">Paid Enrollment</span>}
                    {isLiveEnabled && <span className="registered-badge registered-badge--accent">Live Classes Enabled</span>}
                  </div>
                </div>

                <div className="registered-course-card__footer">
                  <Link
                    className="button button-dark registered-continue-btn"
                    to={course.next_topic_id ? `/course/${course.slug}#topic-${course.next_topic_id}` : `/course/${course.slug}`}
                  >
                    Continue Course <ArrowRight size={16} />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModuleBlock({
  module,
  courseAccess,
  completedTopicIds,
}: {
  module: Course["modules"][number];
  courseAccess: boolean;
  completedTopicIds: number[];
}) {
  const [open, setOpen] = useState(false);
  const resourceCount = module.topics.reduce(
    (total, topic) => total + (topic.resources?.length ?? 0),
    0,
  );

  return (
    <div className={`module-card ${open ? "module-card-open" : ""}`}>
      <button type="button" className="module-card-head" onClick={() => setOpen((value) => !value)}>
        <div className="module-card-title-wrap">
          <span className="module-card-bullet">📁</span>
          <span className="module-card-index">
            {String(module.sort_order || 1).padStart(2, "0")}
          </span>
          <span className="module-card-name">{module.title}</span>
        </div>
        <div className="module-card-meta">
          <span>
            {module.topics.length} topics · {resourceCount} resources
          </span>
          <ChevronDown className={open ? "rotate" : ""} size={18} />
        </div>
      </button>

      {open && (
        <div className="module-card-body">
          {module.topics.length ? (
            module.topics.map((topic, index) => (
              <TopicRoadmapRow
                key={topic.id}
                topic={topic}
                index={index}
                courseAccess={courseAccess}
                initiallyCompleted={completedTopicIds.includes(topic.id)}
              />
            ))
          ) : (
            <div className="empty-module-note">No topics added to this module yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

function TopicRoadmapRow({
  topic,
  index,
  courseAccess,
  initiallyCompleted,
}: {
  topic: Topic;
  index: number;
  courseAccess: boolean;
  initiallyCompleted: boolean;
}) {
  const [completed, setCompleted] = useState(initiallyCompleted);
  const [busy, setBusy] = useState(false);
  const [resourcePage, setResourcePage] = useState(1);
  const [resourcePageSize, setResourcePageSize] = useState(10);

  const toggleCompleted = async () => {
    setBusy(true);
    try {
      await api(`/courses/topics/${topic.id}/progress?completed=${!completed}`, { method: "PATCH" });
      setCompleted((value) => !value);
    } finally {
      setBusy(false);
    }
  };

  const resources = topic.resources || [];
  const resourceTotalPages = Math.max(1, Math.ceil(resources.length / resourcePageSize));
  const safeResourcePage = Math.min(resourcePage, resourceTotalPages);
  const visibleResources = resources.slice(
    (safeResourcePage - 1) * resourcePageSize,
    safeResourcePage * resourcePageSize,
  );
  const resourcePageNumbers = Array.from({ length: resourceTotalPages }, (_, item) => item + 1);

  return (
    <div className="module-topic-row" id={`topic-${topic.id}`}>
      <span className="module-topic-index">
        {String(index + 1).padStart(2, "0")}
      </span>

      <div className="module-topic-copy">
        <span className="module-topic-title">
          <FolderOpen size={14} />
          <b>{topic.title}</b>
        </span>
        <small>
          {topic.summary || "Concept notes, examples and an exam-ready recap."}
        </small>
      </div>

      {courseAccess ? (
        <div className="module-topic-actions">
          <button className="button button-small" type="button" disabled={busy} onClick={() => void toggleCompleted()}>
            {completed ? "Completed" : "Mark complete"}
          </button>
          <div className="resource-pills">
            {visibleResources.map((resource) => (
              <ResourceMedia resource={resource} key={resource.id} />
            ))}
            {resources.length > 0 && (
              <div className="resource-pagination" aria-label={`${topic.title} resources pagination`}>
                <div className="resource-page-size">
                  <label htmlFor={`resource-page-size-${topic.id}`}>Files per page</label>
                  <select
                    id={`resource-page-size-${topic.id}`}
                    value={resourcePageSize}
                    onChange={(event) => {
                      setResourcePageSize(Number(event.target.value));
                      setResourcePage(1);
                    }}
                  >
                    {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
                {resourceTotalPages > 1 && (
                  <div className="resource-page-controls">
                    <button
                      type="button"
                      className="button button-small"
                      disabled={safeResourcePage === 1}
                      onClick={() => setResourcePage((page) => Math.max(1, page - 1))}
                    >
                      <ChevronLeft size={14} /> Previous
                    </button>
                    <div className="resource-page-numbers">
                      {resourcePageNumbers.map((page) => (
                        <button
                          type="button"
                          key={page}
                          className={`resource-page-pill ${page === safeResourcePage ? "is-active" : ""}`}
                          aria-label={`Resource page ${page}`}
                          aria-current={page === safeResourcePage ? "page" : undefined}
                          onClick={() => setResourcePage(page)}
                        >
                          {page}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="button button-small"
                      disabled={safeResourcePage === resourceTotalPages}
                      onClick={() => setResourcePage((page) => Math.min(resourceTotalPages, page + 1))}
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                )}
                <span className="resource-page-status">
                  Showing {(safeResourcePage - 1) * resourcePageSize + 1}–{Math.min(safeResourcePage * resourcePageSize, resources.length)} of {resources.length} files
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="locked-access-notice">
          <Lock size={13} />
          <span>Locked / Enroll to access.</span>
        </div>
      )}
    </div>
  );
}

const mockTestData = [
  {
    id: 1,
    title: "Free Demo Paper 1",
    questions: 50,
    duration: "90 min",
    marks: 100,
    premium: false,
  },
  {
    id: 2,
    title: "Full-Length Mock Pack (Sample)",
    questions: 100,
    duration: "150 min",
    marks: 200,
    premium: true,
  },
];

const testimonials = [
  {
    name: "Jashan Singh",
    affiliation: "JNU",
    text: "The way Amit sir teaches is very simple and understandable but very unique. His ability to teach complex historical processes in simple words made me understand every concept, which also helped in learning facts. Amit sir's teaching had the biggest role in my CUET journey.",
    status: "Cleared UGC NET JRF",
  },
  {
    name: "Vanaj, AUD",
    affiliation: "AUD",
    text: "Amit Sir's teaching is phenomenal. His exam insights made all the difference in my CUET PG preparation. The focus on analysis over memorization is what sets CUET HUNTERS apart.",
    status: "Cleared UGC NET JRF",
  },
  {
    name: "Amartya Barman",
    affiliation: "DU",
    text: "Covered the syllabus in great detail with extra focus on question solving and pattern. Apart from the classes, personal guidance on calls was also provided frequently. Highly recommended.",
    status: "Cleared UGC NET JRF",
  },
];

function FlagshipCard({ user, course }: { user: User | null; course: Course | null }) {
  if (!course) return null;
  const totalResources = course.modules.reduce(
    (count, module) =>
      count +
      module.topics.reduce((topicCount, topic) => topicCount + topic.resources.length, 0),
    0,
  );
  const featureList = [
    `${course.modules.length} structured modules`,
    `${totalResources} study resources`,
    course.access_duration_days === 0 ? "Lifetime access" : `${course.access_duration_days} days access`,
    course.max_students ? `${course.max_students} learner seats` : "Flexible learning",
  ];
  const priceLabel = `₹${(course.price_paise / 100).toLocaleString("en-IN")}`;
  const hasOffer = Boolean(
    course.offer_enabled &&
    course.offer_label?.trim() &&
    course.offer_price_paise != null &&
    course.offer_price_paise > 0 &&
    course.offer_price_paise < course.price_paise,
  );
  const offerPriceLabel = hasOffer
    ? `₹${((course.offer_price_paise || 0) / 100).toLocaleString("en-IN")}`
    : "";
  const savingsLabel = hasOffer
    ? `Save ₹${((course.price_paise - (course.offer_price_paise || 0)) / 100).toLocaleString("en-IN")}`
    : "";
  return (
    <section className="course-hero flagship">
      <div>
        <span className="eyebrow">FLAGSHIP</span>
        <h1>{course.title}</h1>
        <p>
          <em>{course.description || course.subject || "Live + recorded preparation program"}</em>
        </p>
        <ul className="flag-bullets">
          {featureList.map((item) => (
            <li key={item}>
              <Check size={14} />
              {item}
            </li>
          ))}
        </ul>
        <div className="price-row">
          {hasOffer ? (
            <>
              <span className="offer-label">{course.offer_label}</span>
              <span className="offer">{offerPriceLabel}</span>
              <span className="original"><s>{priceLabel}</s></span>
              <span className="offer-savings">{savingsLabel}</span>
            </>
          ) : (
            <span className="offer">{priceLabel}</span>
          )}
        </div>
        <div style={{ marginTop: 18 }}>
          <Link
            className="button button-lime"
            to={user ? `/course/${course.slug}` : "/login"}
          >
            {user ? "Enroll now" : "Start learning"}
            <ArrowRight size={16} />
          </Link>
          <Link
            className="button button-dark"
            to="/mock-tests"
            style={{ marginLeft: 12 }}
          >
            Take a free mock
          </Link>
        </div>
      </div>
      <div className="course-stamp">
        <img
          src="/dist/assets/logo.jpeg"
          alt="logo"
          style={{ width: 74 }}
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      </div>
    </section>
  );
}

function MockTests({ user }: { user: User | null }) {
  return <QuizStudio user={user} />;
}

function QuizStudio({ user }: { user: User | null }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState("");
  const [selectedSubjectArea, setSelectedSubjectArea] = useState("");
  const [selectedSubjectCode, setSelectedSubjectCode] = useState("");
  const [years, setYears] = useState<number[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [papers, setPapers] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [questionBankTopics, setQuestionBankTopics] = useState<string[]>([]);
  const [topicSearch, setTopicSearch] = useState("");
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const [subtopics, setSubtopics] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState("mixed");
  const [customYears, setCustomYears] = useState("");
  const [count, setCount] = useState(20);
  const [minutes, setMinutes] = useState(30);
  const [sourceMode, setSourceMode] = useState<
    "verified_previous_year" | "practice"
  >("verified_previous_year");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(0);
  const [timeExpired, setTimeExpired] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [showDetailedReport, setShowDetailedReport] = useState(false);
  const [historyReport, setHistoryReport] = useState<{ attempt: QuizAttempt; quiz: Quiz } | null>(null);
  const [historyReportLoading, setHistoryReportLoading] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [history, setHistory] = useState<QuizAttempt[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyScoreFilter, setHistoryScoreFilter] = useState("all");
  const [historyPage, setHistoryPage] = useState(1);
  const [activeAttempt, setActiveAttempt] = useState<QuizAttempt | null>(null);
  const [access, setAccess] = useState<PremiumAccess | null>(null);
  const [bankOptions, setBankOptions] = useState<QuestionBankOptions | null>(
    null,
  );
  const [allAvailableYears, setAllAvailableYears] = useState<number[]>([]);
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [resumeDraft, setResumeDraft] = useState<QuizDraftState | null>(null);

  useEffect(() => {
    if (!user) {
      setResumeDraft(null);
      return;
    }
    setResumeDraft(readQuizDraft(user));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      api<Course[]>("/courses"),
      api<typeof history>("/quizzes/attempts/me"),
      api<QuizAttempt | null>("/quizzes/attempts/active"),
      api<PremiumAccess>("/payments/status"),
      api<QuestionBankOptions>("/quizzes/question-bank/options"),
    ])
      .then(([items, attempts, active, premium, options]) => {
        setCourses(items);
        setHistory(attempts.filter((attempt) => attempt.status === "completed"));
        setActiveAttempt(active);
        setSessionExpiresAt(active?.expires_at ? new Date(active.expires_at).getTime() : 0);
        setAccess(premium);
        setBankOptions(options);
        setAllAvailableYears(options.years || []);
        if (!selectedCourse && items[0]) {
          setSelectedCourse(String(items[0].id));
          setSelectedSubjectArea(items[0].subject || "");
        }
        if (!selectedSubjectCode && options.subjects?.[0]) {
          setSelectedSubjectCode(options.subjects[0].code);
          setSelectedSubjectArea(options.subjects[0].name);
        }
      })
      .catch((cause) => setMessage((cause as Error).message));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams();
    params.set("exam", "UGC NET");
    years.forEach((year) => params.append("years", String(year)));
    sessions.forEach((session) => params.append("sessions", session));
    papers.forEach((paper) => params.append("papers", paper));
    if (selectedSubjectCode) params.set("subject_code", selectedSubjectCode);
    if (difficulty !== "mixed") params.set("difficulty", difficulty);
    api<QuestionBankOptions>(`/quizzes/question-bank/options?${params.toString()}`)
      .then((options) => setBankOptions((current) => ({ ...options, years: allAvailableYears.length ? allAvailableYears : options.years })))
      .catch((cause) => setMessage(`Question filters could not be refreshed: ${(cause as Error).message}`));
  }, [user, years.join(","), sessions.join("|"), papers.join("|"), selectedSubjectCode, difficulty, allAvailableYears.join(",")]);

  useEffect(() => {
    const validTopics = new Set(bankOptions?.topics || []);
    setQuestionBankTopics((current) => current.filter((topic) => validTopics.has(topic)));
  }, [bankOptions?.topics]);

  const course = courses.find((item) => String(item.id) === selectedCourse);
  const topics =
    course?.modules.flatMap((module) =>
      module.topics.map((topic) => ({ ...topic, moduleTitle: module.title })),
    ) || [];
  const availableYears =
    (allAvailableYears.length ? allAvailableYears : bankOptions?.years || []).slice().sort((a, b) => a - b);
  const availableCategories = bankOptions?.categories || [];
  const availableSubtopics = bankOptions?.subtopics || [];
  const availableSubjects = bankOptions?.subjects || [];
  const availableSessions = bankOptions?.sessions || [];
  const availablePapers = bankOptions?.papers || [];
  const visibleTopics = (bankOptions?.topics || []).filter((topic) =>
    topic.toLocaleLowerCase().includes(topicSearch.toLocaleLowerCase().trim()),
  );
  const availableDifficulties = Array.from(
    new Set(["easy", "medium", "hard", ...(bankOptions?.difficulties || [])]),
  );
  const facetSignature = (values: string[]) =>
    values
      .map((value) => value.trim().toLocaleLowerCase())
      .sort()
      .join("|");
  const showCategories =
    availableCategories.length > 0 &&
    !(
      bankOptions?.topics?.length &&
      facetSignature(availableCategories) === facetSignature(bankOptions.topics)
    );
  const toggleYear = (year: number) =>
    setYears((current) =>
      current.includes(year)
        ? current.filter((item) => item !== year)
        : [...current, year],
    );
  const toggleCategory = (category: string) =>
    setCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  const toggleQuestionBankTopic = (topic: string) =>
    setQuestionBankTopics((current) =>
      current.includes(topic)
        ? current.filter((item) => item !== topic)
        : [...current, topic],
    );
  const toggleSession = (session: string) =>
    setSessions((current) => current.includes(session) ? current.filter((item) => item !== session) : [...current, session]);
  const togglePaper = (paper: string) =>
    setPapers((current) => current.includes(paper) ? current.filter((item) => item !== paper) : [...current, paper]);
  const toggleSubtopic = (subtopic: string) =>
    setSubtopics((current) =>
      current.includes(subtopic)
        ? current.filter((item) => item !== subtopic)
        : [...current, subtopic],
    );

  const submitQuiz = async (force = false) => {
    if (!quiz || loading || result) return;
    const unanswered = quiz.questions.filter(
      (question) => answers[String(question.id)] === undefined,
    );
    if (unanswered.length && !force) {
      setMessage(
        `Answer all questions before finishing. ${unanswered.length} question${unanswered.length === 1 ? "" : "s"} remain.`,
      );
      return;
    }
    setLoading(true);
    try {
      const response = await api<QuizResult>(`/quizzes/${quiz.id}/submit`, {
        method: "POST",
        body: JSON.stringify({
          answers,
          attempt_id: activeAttempt?.id,
          time_spent_seconds: startedAt
            ? Math.floor((Date.now() - startedAt) / 1000)
            : 0,
        }),
      });
      setResult(response);
      setActiveAttempt(null);
      setSessionExpiresAt(0);
      setTimeExpired(false);
      persistQuizDraft(user, null);
      setResumeDraft(null);
      setMessage(
        force && unanswered.length
          ? "Time ended. Your answered questions were submitted."
          : "Quiz completed. Your topic report is ready.",
      );
      const attempts = await api<typeof history>("/quizzes/attempts/me");
      setHistory(attempts.filter((attempt) => attempt.status === "completed"));
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submitQuizRef = useRef(submitQuiz);
  submitQuizRef.current = submitQuiz;

  useEffect(() => {
    if (!sessionExpiresAt || result) return;
    const updateFromClock = () => {
      const remaining = Math.max(0, Math.floor((sessionExpiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0 && quiz && !timeExpired) {
        setTimeExpired(true);
        void submitQuizRef.current(true);
      }
    };
    updateFromClock();
    const timer = window.setInterval(updateFromClock, 1000);
    window.addEventListener("focus", updateFromClock);
    document.addEventListener("visibilitychange", updateFromClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateFromClock);
      document.removeEventListener("visibilitychange", updateFromClock);
    };
  }, [sessionExpiresAt, result, quiz, timeExpired]);

  useEffect(() => {
    if (!quiz || result || !activeAttempt) {
      if (!quiz && !result) {
        setResumeDraft(readQuizDraft(user));
      }
      return;
    }
    const expiresAt = sessionExpiresAt || (activeAttempt.expires_at
      ? new Date(activeAttempt.expires_at).getTime()
      : startedAt + Math.max(0, quiz.time_limit_minutes) * 60 * 1000);
    const draft: QuizDraftState = {
      quiz,
      answers,
      currentIndex,
      startedAt,
      expiresAt,
      savedAt: Date.now(),
    };
    const remaining = Math.max(0, Math.ceil((draft.expiresAt - Date.now()) / 1000));
    setSecondsLeft(remaining);
    persistQuizDraft(user, draft);
    setResumeDraft(draft);
    const saveTimer = window.setTimeout(() => {
      api<QuizAttempt>(`/quizzes/attempts/${activeAttempt.id}/progress`, {
        method: "PATCH",
        body: JSON.stringify({
          answers,
          current_index: currentIndex,
          time_spent_seconds: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
        }),
      }).then(setActiveAttempt).catch((cause) => setMessage(`Progress could not be saved: ${(cause as Error).message}`));
    }, 250);
    return () => window.clearTimeout(saveTimer);
  }, [quiz, answers, currentIndex, startedAt, result, user, activeAttempt?.id, activeAttempt?.expires_at, sessionExpiresAt]);

  const resumeSavedQuiz = async () => {
    if (!activeAttempt) {
      setMessage("No active mock test was found.");
      return;
    }
    setLoading(true);
    try {
      const restoredQuiz = await api<Quiz>(`/quizzes/${activeAttempt.quiz_id}`);
      const restoredStartedAt = activeAttempt.started_at ? new Date(activeAttempt.started_at).getTime() : Date.now();
      const restoredExpiresAt = activeAttempt.expires_at ? new Date(activeAttempt.expires_at).getTime() : Date.now() + restoredQuiz.time_limit_minutes * 60 * 1000;
      setQuiz(restoredQuiz);
      setAnswers(activeAttempt.answers || {});
      setCurrentIndex(Math.min(activeAttempt.current_index || 0, Math.max(0, restoredQuiz.questions.length - 1)));
      setStartedAt(restoredStartedAt);
      setSessionExpiresAt(restoredExpiresAt);
      setTimeExpired(restoredExpiresAt <= Date.now());
      setResult(null);
      setSecondsLeft(Math.max(0, Math.ceil((restoredExpiresAt - Date.now()) / 1000)));
      setMessage("Saved mock test restored. Continue exactly from where you left off.");
    } catch (cause) {
      setMessage(`Resume failed: ${(cause as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      setMessage("Sign in before starting a quiz.");
      return;
    }
    const parsedYears = parseYearList(customYears);
    const selectedYears = Array.from(new Set([...years, ...parsedYears])).sort(
      (a, b) => a - b,
    );
    const topicSelection = topics.map((topic) => topic.id);
    if (!topicSelection.length) {
      setMessage("Select at least one UGC NET topic.");
      return;
    }
    setLoading(true);
    setMessage(
      sourceMode === "verified_previous_year"
        ? "Loading existing verified UGC-NET questions from the question bank…"
        : `Generating ${count} UGC NET practice questions from the selected topic${topicSelection.length > 1 ? "s" : ""}…`,
    );
    setResult(null);
    try {
      const generated = await api<Quiz>("/quizzes/generate", {
        method: "POST",
        body: JSON.stringify({
          topic_ids: topicSelection,
          exam: "UGC NET",
          years: selectedYears,
          sessions,
          papers,
          subject_code: selectedSubjectCode || undefined,
          subject_name: selectedSubjectArea || undefined,
          categories,
          question_bank_topics: questionBankTopics,
          subtopics,
          difficulty,
          subject: course?.subject || "UGC NET",
          count,
          time_limit_minutes: minutes,
          source_mode: sourceMode,
        }),
      });
      const startedAttempt = await api<QuizAttempt>(`/quizzes/${generated.id}/attempt/start`, { method: "POST" });
      const generatedStartedAt = startedAttempt.started_at ? new Date(startedAttempt.started_at).getTime() : Date.now();
      setQuiz(generated);
      setActiveAttempt(startedAttempt);
      setAnswers(startedAttempt.answers || {});
      setCurrentIndex(startedAttempt.current_index || 0);
      setStartedAt(generatedStartedAt);
      const generatedExpiresAt = startedAttempt.expires_at ? new Date(startedAttempt.expires_at).getTime() : 0;
      setSessionExpiresAt(generatedExpiresAt);
      setTimeExpired(false);
      setSecondsLeft(generatedExpiresAt ? Math.max(0, Math.floor((generatedExpiresAt - Date.now()) / 1000)) : generated.time_limit_minutes * 60);
      persistQuizDraft(user, null);
      setResumeDraft(null);
      setPaymentRequired(false);
      setMessage(
        `${generated.questions.length} questions loaded. ${generated.availability_notice || "You can move between questions and return to skipped ones."}`,
      );
      api<PremiumAccess>("/payments/status")
        .then(setAccess)
        .catch(() => undefined);
    } catch (cause) {
      const detail = (cause as Error).message;
      if (
        detail.toLowerCase().includes("free mock") ||
        detail.toLowerCase().includes("premium access")
      )
        setPaymentRequired(true);
      setMessage(`Quiz generation failed: ${detail}`);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    persistQuizDraft(user, null);
    setResumeDraft(null);
    setActiveAttempt(null);
    setSessionExpiresAt(0);
    setTimeExpired(false);
    setQuiz(null);
    setResult(null);
    setAnswers({});
    setCurrentIndex(0);
    setMessage("");
  };
  const exitActiveAttempt = async () => {
    if (!activeAttempt || loading) return;
    setLoading(true);
    try {
      await api<void>(`/quizzes/attempts/${activeAttempt.id}`, { method: "DELETE" });
      persistQuizDraft(user, null);
      setActiveAttempt(null);
      setSessionExpiresAt(0);
      setTimeExpired(false);
      setQuiz(null);
      setAnswers({});
      setCurrentIndex(0);
      setMessage("The in-progress test was exited.");
    } catch (cause) {
      setMessage(`Could not exit test: ${(cause as Error).message}`);
    } finally {
      setLoading(false);
    }
  };
  const downloadReportPdf = () => {
    setShowDetailedReport(true);
    window.setTimeout(() => window.print(), 120);
  };
  const downloadHistoryReportPdf = async (attempt: QuizAttempt) => {
    if (!attempt.report_available) return;
    setHistoryReportLoading(true);
    try {
      const reportQuiz = await api<Quiz>(`/quizzes/${attempt.quiz_id}`);
      setHistoryReport({ attempt, quiz: reportQuiz });
      window.setTimeout(() => window.print(), 160);
    } catch (cause) {
      setMessage(`Report download failed: ${(cause as Error).message}`);
    } finally {
      setHistoryReportLoading(false);
    }
  };
  const exitAndSaveQuiz = () => {
    if (quiz) {
      const expiresAt = sessionExpiresAt || (startedAt + quiz.time_limit_minutes * 60 * 1000);
      persistQuizDraft(user, { quiz, answers, currentIndex, startedAt, expiresAt, savedAt: Date.now() });
    }
    setShowExitDialog(false);
    setQuiz(null);
    setResult(null);
    setMessage("Your progress is saved. Resume the test while time remains.");
  };
  const question = quiz?.questions[currentIndex];
  const formatTime = formatQuizTimer;
  const answeredCount = quiz ? Object.keys(answers).length : activeAttempt ? Object.keys(activeAttempt.answers || {}).length : 0;
  const activeTotal = activeAttempt?.total || 0;
  const activeProgress = activeTotal ? Math.min(100, Math.round(((activeAttempt!.current_index + 1) / activeTotal) * 100)) : 0;
  const activeSecondsLeft = activeAttempt?.expires_at
    ? quiz
      ? Math.max(0, Math.floor((sessionExpiresAt - Date.now()) / 1000))
      : secondsLeft
    : 0;
  const unansweredCount = quiz ? quiz.questions.filter((item) => answers[String(item.id)] === undefined).length : 0;
  const wrongCount = result ? Math.max(0, result.total - result.correct - unansweredCount) : 0;
  const filteredHistory = useMemo(() => {
    const search = historySearch.trim().toLocaleLowerCase();
    return history.filter((attempt) => {
      const matchesSearch = !search || `${attempt.quiz_title} ${attempt.strong_topics?.join(" ") || ""}`.toLocaleLowerCase().includes(search);
      const matchesScore = historyScoreFilter === "all"
        || historyScoreFilter === "high" && attempt.score >= 70
        || historyScoreFilter === "needs-work" && attempt.score < 70;
      return matchesSearch && matchesScore;
    });
  }, [history, historySearch, historyScoreFilter]);
  const historyPageSize = 5;
  const historyPageCount = Math.max(1, Math.ceil(filteredHistory.length / historyPageSize));
  const visibleHistory = filteredHistory.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize);
  useEffect(() => setHistoryPage(1), [historySearch, historyScoreFilter]);

  if (!user)
    return (
      <div className="container">
        <div className="empty-state">
          <ListChecks size={28} />
          <h2>UGC NET quiz studio.</h2>
          <p>
            Sign in to choose years and topics, save attempts, and track your
            topic-wise progress.
          </p>
          <Link to="/login" className="button button-dark">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  return (
    <div className="container quiz-page">
      <div className="section-heading quiz-page-heading">
        <div>
          <span className="eyebrow">UGC NET QUESTION LAB</span>
          <h2>Choose. Practise. Improve.</h2>
        </div>
        <div className="quiz-page-heading-meta">
          <span className="quiz-heading-mark"><ListChecks size={16} /></span>
          <span className="muted">Year and topic-wise progress</span>
        </div>
      </div>
      {message && <div className="notice">{message}</div>}
      {!quiz && (
        <section className="active-tests-section">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow active-eyebrow">IN-PROGRESS TESTS</span>
              <h3>Pick up where you left off</h3>
            </div>
            <span className="muted">Your active test is saved automatically</span>
          </div>
          {activeAttempt ? (
            <article className="active-test-card">
              <div className="active-test-status"><span className="active-dot" /> TEST IN PROGRESS</div>
              <div className="active-test-main">
                <div>
                  <h3>{activeAttempt.quiz_title}</h3>
                  <p>{activeAttempt.total} questions · Started {activeAttempt.started_at ? new Date(activeAttempt.started_at).toLocaleString() : "recently"}</p>
                </div>
                <div className="active-test-timer"><Clock3 size={16} /> {activeAttempt.expires_at ? `${formatTime(activeSecondsLeft)} remaining` : "No time limit"}</div>
              </div>
              <div className="active-test-progress-meta">
                <span>Question {Math.min(activeAttempt.current_index + 1, activeTotal)} of {activeTotal}</span>
                <span>{answeredCount} answered · {Math.max(0, activeTotal - answeredCount)} unanswered</span>
              </div>
              <div className="active-test-progress"><span style={{ width: `${activeProgress}%` }} /></div>
              <div className="active-test-footer">
                <small>Last saved automatically</small>
                <div>
                  <button type="button" className="button button-lime" onClick={() => void resumeSavedQuiz()} disabled={loading}><Play size={15} /> Resume Test</button>
                  <button type="button" className="button button-small" onClick={() => void exitActiveAttempt()} disabled={loading}>Exit Test</button>
                </div>
              </div>
            </article>
          ) : (
            <div className="no-active-test"><CheckCircle2 size={18} /> No tests currently in progress</div>
          )}
        </section>
      )}
      {!quiz && access && (!access.free_mock_available || paymentRequired) && (
        <PremiumPaywall
          access={access}
          feature="mock"
          onPaid={async () => {
            const fresh = await api<PremiumAccess>("/payments/status");
            setAccess(fresh);
            setPaymentRequired(false);
            setMessage(
              "Premium access is active. Generate your mock test now.",
            );
          }}
        />
      )}
      {!quiz && (
        <form className="quiz-builder panel quiz-builder-card" onSubmit={generate}>
          <div className="quiz-builder-head">
            <div>
              <span className="eyebrow">QUIZ SETUP</span>
              <h3>Build your question paper</h3>
            </div>
            <ListChecks size={24} />
          </div>
          <div className="quiz-builder-grid quiz-builder-primary">
            <label>
              Subject / course
              <select
                value={selectedCourse}
                onChange={(event) => setSelectedCourse(event.target.value)}
                required
              >
                <option value="">Choose course</option>
                {courses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.subject ? `${item.subject} · ` : ""}
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Question source
              <select
                value={sourceMode}
                onChange={(event) =>
                  setSourceMode(
                    event.target.value as "verified_previous_year" | "practice",
                  )
                }
              >
                <option value="verified_previous_year">
                  Existing verified question bank
                </option>
                <option value="practice">AI practice from course/topic</option>
              </select>
            </label>
            <label>
              Question count (max 25)
              <select
                value={count}
                onChange={(event) =>
                  setCount(Math.min(25, Number(event.target.value)))
                }
              >
                {[5, 10, 15, 20, 25].map((value) => (
                  <option key={value} value={value}>
                    {value} questions
                  </option>
                ))}
              </select>
            </label>
            <label>
              Time limit
              <select
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
              >
                <option value={0}>No limit</option>
                {[10, 20, 30, 45, 60, 90, 120].map((value) => (
                  <option key={value} value={value}>
                    {value} minutes
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="quiz-filter-block quiz-filter-section">
            <span className="eyebrow">YEARS · MULTI-SELECT</span>
            <div className="chip-row">
              {availableYears.map((year) => (
                <button
                  type="button"
                  className={
                    years.includes(year) ? "filter-chip active" : "filter-chip"
                  }
                  key={year}
                  onClick={() => toggleYear(year)}
                >
                  {year}
                </button>
              ))}
            </div>
            <input
              value={customYears}
              onChange={(event) => setCustomYears(event.target.value)}
              placeholder="Enter years e.g. 2018,2019"
            />
            <small className="muted">
              Selected years:{" "}
              {Array.from(new Set([...years, ...parseYearList(customYears)]))
                .sort((a, b) => a - b)
                .join(", ") || "All years"}
            </small>
          </div>
          <div className="quiz-filter-block quiz-filter-section">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">QUESTION BANK FILTERS</span>
                <small className="muted">
                  These values come from existing rows in the Cloudflare D1
                  questions table. No extractor is run during quiz generation.
                </small>
              </div>
              <label>
                Difficulty
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value)}
                >
                  <option value="mixed">All difficulties</option>
                  {availableDifficulties.map((value) => (
                    <option key={value} value={value}>
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!bankOptions?.available && (
              <small className="muted">
                The question bank is not currently available; the server will
                show a clear no-data message for unmatched filters.
              </small>
            )}
            {bankOptions?.topics?.length ? (
              <>
                <span className="eyebrow">QUESTION TOPICS · D1 FILTERED</span>
                <div className="topic-picker">
                  <button type="button" className="topic-picker-trigger" onClick={() => setTopicMenuOpen((open) => !open)} aria-expanded={topicMenuOpen}>
                    <span><Search size={15} /> {questionBankTopics.length ? `${questionBankTopics.length} topics selected` : "Select topics"}</span>
                    <ChevronDown size={16} />
                  </button>
                  {topicMenuOpen && (
                    <div className="topic-picker-menu">
                      <input value={topicSearch} onChange={(event) => setTopicSearch(event.target.value)} placeholder="Search topics" autoFocus />
                      <button type="button" className="topic-select-all" onClick={() => setQuestionBankTopics(questionBankTopics.length === bankOptions.topics.length ? [] : bankOptions.topics)}>
                        {questionBankTopics.length === bankOptions.topics.length ? "Clear all" : "Select all"}
                      </button>
                      <div className="topic-picker-options">
                        {visibleTopics.map((topic) => (
                          <label key={topic} className="topic-picker-option">
                            <input type="checkbox" checked={questionBankTopics.includes(topic)} onChange={() => toggleQuestionBankTopic(topic)} />
                            <span>{topic}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <small className="muted">
                  Selected database topics:{" "}
                  {questionBankTopics.join(", ") || "All database topics"}
                </small>
              </>
            ) : null}
            {availableSessions.length > 0 && (
              <>
                <span className="eyebrow">SESSION</span>
                <div className="chip-row">{availableSessions.map((session) => <button type="button" className={sessions.includes(session) ? "filter-chip active" : "filter-chip"} key={session} onClick={() => toggleSession(session)}>{session}</button>)}</div>
              </>
            )}
            {availablePapers.length > 0 && (
              <>
                <span className="eyebrow">PAPER</span>
                <div className="chip-row">{availablePapers.map((paper) => <button type="button" className={papers.includes(paper) ? "filter-chip active" : "filter-chip"} key={paper} onClick={() => togglePaper(paper)}>{paper}</button>)}</div>
              </>
            )}
            {showCategories && (
              <>
                <span className="eyebrow">CATEGORIES / PAPER UNITS</span>
                <div className="chip-row">
                  {availableCategories.map((category) => (
                    <button
                      type="button"
                      className={
                        categories.includes(category)
                          ? "filter-chip active"
                          : "filter-chip"
                      }
                      key={category}
                      onClick={() => toggleCategory(category)}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                <small className="muted">
                  Selected categories:{" "}
                  {categories.join(", ") || "All categories"}
                </small>
              </>
            )}
            {availableSubtopics.length > 0 && (
              <>
                <span className="eyebrow">SUBTOPICS · MULTI-SELECT</span>
                <div className="chip-row">
                  {availableSubtopics.map((subtopic) => (
                    <button
                      type="button"
                      className={
                        subtopics.includes(subtopic)
                          ? "filter-chip active"
                          : "filter-chip"
                      }
                      key={subtopic}
                      onClick={() => toggleSubtopic(subtopic)}
                    >
                      {subtopic}
                    </button>
                  ))}
                </div>
                <small className="muted">
                  Selected subtopics: {subtopics.join(", ") || "All subtopics"}
                </small>
              </>
            )}
          </div>
          <div className="quiz-filter-block subject-area-block quiz-filter-section">
            <div className="subject-area-heading">
              <div>
                <span className="eyebrow">UGC NET SUBJECT AREAS</span>
                <small className="muted">
                  Select a subject from the verified question bank.
                </small>
              </div>
              <span className="subject-area-count">
                {availableSubjects.length} available
              </span>
            </div>
            {availableSubjects.length ? (
              <div className="subject-toggle-grid" role="group" aria-label="Available UGC NET subject areas">
                {availableSubjects.map((subject) => {
                  const active = selectedSubjectCode === subject.code;
                  return (
                    <button
                      type="button"
                      className={active ? "subject-toggle active" : "subject-toggle"}
                      key={subject.code}
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedSubjectArea(subject.name);
                        setSelectedSubjectCode(subject.code);
                        setQuestionBankTopics([]);
                        setMessage(`${subject.name} selected from the verified question bank.`);
                      }}
                    >
                      <span className="subject-toggle-mark">{active ? <Check size={15} /> : <BookOpen size={15} />}</span>
                      <span>{subject.code} · {subject.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <small className="muted">No subjects are available for the selected question-bank filters.</small>
            )}
          </div>
          <div className="quiz-builder-submit-row">
          <small className="quiz-builder-note">Questions are selected from the verified question bank using your filters.</small>
          <button
            className="button button-lime"
            disabled={loading || !selectedCourse}
          >
            {loading
              ? sourceMode === "verified_previous_year"
                ? "Loading existing questions…"
                : "Generating questions…"
              : "Generate quiz"}
            <ArrowRight size={16} />
          </button>
          </div>
        </form>
      )}
      {quiz && !result && question && (
        <section className="quiz-run panel quiz-run-card">
          <div className="quiz-run-top">
            <div>
              <button type="button" className="quiz-exit-link" onClick={() => setShowExitDialog(true)}>
                <ChevronLeft size={15} /> Exit & save
              </button>
              <span className="eyebrow">
                {quiz.subject} ·{" "}
                {quiz.years.length ? quiz.years.join(", ") : "ALL YEARS"}
              </span>
              <h3>{quiz.title}</h3>
              <small>
                {question.topic} · Question {currentIndex + 1} of{" "}
                {quiz.questions.length}
              </small>
            </div>
            <div className="quiz-timer">
              {quiz.time_limit_minutes ? (
                <>
                  <Clock3 size={15} />
                  {formatTime(secondsLeft)}
                </>
              ) : (
                <>
                  <Clock3 size={15} />
                  No limit
                </>
              )}
            </div>
          </div>
          {timeExpired && (
            <div className="quiz-expired-banner">
              <Clock3 size={18} />
              <div><strong>TIME EXPIRED</strong><span>Your saved answers are being submitted.</span></div>
            </div>
          )}
          <div className="question-progress">
            <span
              style={{
                width: `${((currentIndex + 1) / quiz.questions.length) * 100}%`,
              }}
            />
          </div>
          <div className="question-meta">
            <span>
              {question.year || "Practice"} · {question.question_type}
            </span>
            {question.verified && (
              <span className="verified-tag">
                <CheckCircle2 size={13} />
                Verified source
              </span>
            )}
          </div>
          <h2 className="question-text">{question.question}</h2>
          {question.graph_data && (
            <pre className="question-structure">
              Graph data{`\n`}
              {JSON.stringify(question.graph_data, null, 2)}
            </pre>
          )}
          {question.table_data && (
            <pre className="question-structure">
              Table data{`\n`}
              {JSON.stringify(question.table_data, null, 2)}
            </pre>
          )}
          {question.diagram_data && (
            <pre className="question-structure">
              Diagram data{`\n`}
              {JSON.stringify(question.diagram_data, null, 2)}
            </pre>
          )}
          <div className="question-options">
            {question.options.map((option, optionIndex) => (
              <label
                className={
                  answers[String(question.id)] === optionIndex
                    ? "question-option selected"
                    : "question-option"
                }
                key={`${question.id}-${optionIndex}`}
              >
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  checked={answers[String(question.id)] === optionIndex}
                  disabled={timeExpired || loading}
                  onChange={() =>
                    setAnswers((current) => ({
                      ...current,
                      [String(question.id)]: optionIndex,
                    }))
                  }
                />
                <span className="option-letter">
                  {String.fromCharCode(65 + optionIndex)}
                </span>
                <span>{option}</span>
              </label>
            ))}
          </div>
          <div className="question-nav">
            <button
              className="button button-small"
              type="button"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((value) => value - 1)}
            >
              <ChevronLeft size={15} />
              Previous
            </button>
            <div className="question-jump">
              {quiz.questions.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className={
                    index === currentIndex
                      ? "question-dot active"
                      : answers[String(item.id)] !== undefined
                        ? "question-dot answered"
                        : "question-dot"
                  }
                  onClick={() => setCurrentIndex(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
            {currentIndex < quiz.questions.length - 1 ? (
              <button
                className="button button-small"
                type="button"
                onClick={() => setCurrentIndex((value) => value + 1)}
              >
                Next
                <ChevronRight size={15} />
              </button>
            ) : (
              <button
                className="button button-lime button-small"
                type="button"
                onClick={() => void submitQuiz(false)}
                disabled={loading}
              >
                {loading ? "Scoring…" : "Finish & see score"}
                <Check size={15} />
              </button>
            )}
          </div>
        </section>
      )}
      {quiz && result && (
        <section className="quiz-result panel">
          <div className="quiz-result-head">
            <div>
              <span className="eyebrow">QUIZ COMPLETE</span>
              <h3>{result.score}% score</h3>
              <p>
                {result.correct} correct out of {result.total} questions
              </p>
              <div className="result-stat-row">
                <span><b>{result.correct}</b> Correct</span>
                <span><b>{wrongCount}</b> Wrong</span>
                <span><b>{unansweredCount}</b> Unanswered</span>
              </div>
              <p>
                <b>Strong topics:</b>{" "}
                {result.strong_topics?.join(", ") ||
                  "Keep practising to build a strong area."}
              </p>
            </div>
            <div className="score-orb">{result.score}</div>
          </div>
          <div className="topic-score-grid">
            {Object.entries(result.topic_scores).map(([topic, score]) => (
              <div className="topic-score" key={topic}>
                <div>
                  <b>{topic}</b>
                  <span>
                    {score.correct}/{score.total}
                  </span>
                </div>
                <div className="score-bar">
                  <span style={{ width: `${score.percentage}%` }} />
                </div>
                <small>{score.percentage}% mastery</small>
              </div>
            ))}
          </div>
          <div className="report-card">
            <span className="eyebrow">GROQ STUDY REPORT</span>
            <p>{result.report}</p>
            <small className="muted">
              Detailed report available until{" "}
              {result.report_expires_at
                ? new Date(result.report_expires_at).toLocaleDateString()
                : "30 days after this attempt"}
              . Your score, percentage, and strong topics remain in progress
              history.
            </small>
          </div>
          <div className="quiz-result-actions">
            <button className="button button-lime" type="button" onClick={() => setShowDetailedReport(true)}>
              <Eye size={15} /> View detailed report
            </button>
            <button className="button" type="button" onClick={downloadReportPdf}>
              <Download size={15} /> Download report PDF
            </button>
            <button
              className="button button-lime"
              type="button"
              onClick={reset}
            >
              <RefreshCw size={15} /> New quiz
            </button>
          </div>
          <details className="answer-review">
            <summary>Review solutions and sources</summary>
            {quiz.questions.map((item, index) => {
              const solution = result.solutions.find(
                (entry) => entry.question_id === item.id,
              );
              return (
                <div className="answer-review-row" key={item.id}>
                  <b>
                    {index + 1}. {item.question}
                  </b>
                  <span>
                    Your answer:{" "}
                    {answers[String(item.id)] === undefined
                      ? "Not answered"
                      : String.fromCharCode(65 + answers[String(item.id)])}{" "}
                    · Correct answer:{" "}
                    {solution && solution.correct_answer_index >= 0
                      ? String.fromCharCode(65 + solution.correct_answer_index)
                      : "Not verified"}
                  </span>
                  <small>
                    {solution?.explanation ||
                      item.explanation ||
                      "No explanation provided."}{" "}
                    {item.source_url && (
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source
                      </a>
                    )}
                  </small>
                </div>
              );
            })}
          </details>
        </section>
      )}
      {quiz && result && showDetailedReport && (
        <section className="detailed-report panel">
          <div className="detailed-report-toolbar">
            <div><span className="eyebrow">DETAILED REPORT</span><h3>{quiz.title}</h3><small>Completed {new Date().toLocaleDateString()}</small></div>
            <button type="button" className="button" onClick={downloadReportPdf}><Download size={15} /> Download PDF</button>
          </div>
          <div className="report-score-summary">
            <div className="report-score-value">{result.score}%</div>
            <div><strong>{result.correct} / {result.total}</strong><span>correct answers</span></div>
            <div><strong>{wrongCount}</strong><span>wrong</span></div>
            <div><strong>{unansweredCount}</strong><span>unanswered</span></div>
          </div>
          <div className="report-ai-panel">
            <span className="eyebrow">AI PERFORMANCE ANALYSIS</span>
            <h4>Study report</h4>
            <p>{result.report || "AI report unavailable for this attempt."}</p>
            <div className="report-strengths"><strong>Strong topics</strong><span>{result.strong_topics?.join(", ") || "Not enough data yet"}</span></div>
          </div>
          <div className="report-question-list">
            <div className="section-heading compact"><div><span className="eyebrow">QUESTION-WISE REVIEW</span><h4>Every question</h4></div></div>
            {quiz.questions.map((item, index) => {
              const solution = result.solutions.find((entry) => entry.question_id === item.id);
              const userAnswer = answers[String(item.id)];
              const correctAnswer = solution?.correct_answer_index;
              const state = userAnswer === undefined ? "unanswered" : userAnswer === correctAnswer ? "correct" : "incorrect";
              return <article className={`report-question-card ${state}`} key={item.id}>
                <div className="report-question-label"><span>Q{index + 1}</span><b>{state === "correct" ? "✓ Correct" : state === "incorrect" ? "✕ Incorrect" : "— Not answered"}</b></div>
                <p className="report-question-text">{item.question}</p>
                <div className="report-options" aria-label={`Answer options for question ${index + 1}`}>
                  {item.options.map((option, optionIndex) => {
                    const isUserAnswer = userAnswer === optionIndex;
                    const isCorrectAnswer = correctAnswer === optionIndex;
                    return (
                      <div
                        className={`report-option${isCorrectAnswer ? " correct-option" : ""}${isUserAnswer ? " user-option" : ""}`}
                        key={`${item.id}-report-option-${optionIndex}`}
                      >
                        <span className="report-option-letter">{String.fromCharCode(65 + optionIndex)}</span>
                        <span className="report-option-text">{option}</span>
                        <span className="report-option-status">
                          {isCorrectAnswer ? "Correct answer" : isUserAnswer ? "Your answer" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="report-answer-grid"><span>Your answer: <b>{userAnswer === undefined ? "Not answered" : String.fromCharCode(65 + userAnswer)}</b></span><span>Correct answer: <b>{correctAnswer === undefined ? "Not verified" : String.fromCharCode(65 + correctAnswer)}</b></span></div>
                <p className="report-explanation"><strong>Explanation:</strong> {solution?.explanation || item.explanation || "No explanation provided."}</p>
                {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">View source</a>}
              </article>;
            })}
          </div>
        </section>
      )}
      {historyReport && (
        <section className="detailed-report panel history-report-view">
          <div className="detailed-report-toolbar">
            <div>
              <span className="eyebrow">COMPLETED REPORT</span>
              <h3>{historyReport.quiz.title}</h3>
              <small>Completed {new Date(historyReport.attempt.completed_at || historyReport.attempt.created_at).toLocaleDateString()}</small>
            </div>
            <div className="report-toolbar-actions">
              <button type="button" className="button" onClick={() => window.print()}><Download size={15} /> Download PDF</button>
              <button type="button" className="button button-small" onClick={() => setHistoryReport(null)}>Close report</button>
            </div>
          </div>
          <div className="report-score-summary">
            <div className="report-score-value">{historyReport.attempt.score}%</div>
            <div><strong>{historyReport.attempt.correct} / {historyReport.attempt.total}</strong><span>correct answers</span></div>
            <div><strong>{Math.max(0, Object.keys(historyReport.attempt.answers || {}).length - historyReport.attempt.correct)}</strong><span>wrong</span></div>
            <div><strong>{Math.max(0, historyReport.attempt.total - Object.keys(historyReport.attempt.answers || {}).length)}</strong><span>unanswered</span></div>
          </div>
          <div className="report-ai-panel">
            <span className="eyebrow">AI PERFORMANCE ANALYSIS</span>
            <h4>Study report</h4>
            <p>{historyReport.attempt.report || "AI report unavailable for this attempt."}</p>
            <div className="report-strengths"><strong>Strong topics</strong><span>{historyReport.attempt.strong_topics?.join(", ") || "Not enough data yet"}</span></div>
          </div>
          <div className="report-question-list">
            <div className="section-heading compact"><div><span className="eyebrow">QUESTION-WISE REVIEW</span><h4>Questions, options and answers</h4></div></div>
            {historyReport.quiz.questions.map((item, index) => {
              const userAnswer = historyReport.attempt.answers?.[String(item.id)];
              const correctAnswer = item.answer_index;
              const state = userAnswer === undefined ? "unanswered" : userAnswer === correctAnswer ? "correct" : "incorrect";
              return <article className={`report-question-card ${state}`} key={item.id}>
                <div className="report-question-label"><span>Q{index + 1}</span><b>{state === "correct" ? "✓ Correct" : state === "incorrect" ? "✕ Incorrect" : "— Not answered"}</b></div>
                <p className="report-question-text">{item.question}</p>
                <div className="report-options">
                  {item.options.map((option, optionIndex) => {
                    const isUserAnswer = userAnswer === optionIndex;
                    const isCorrectAnswer = correctAnswer === optionIndex;
                    return <div className={`report-option${isCorrectAnswer ? " correct-option" : ""}${isUserAnswer ? " user-option" : ""}`} key={`${item.id}-history-option-${optionIndex}`}>
                      <span className="report-option-letter">{String.fromCharCode(65 + optionIndex)}</span>
                      <span className="report-option-text">{option}</span>
                      <span className="report-option-status">{isCorrectAnswer ? "Correct answer" : isUserAnswer ? "Your answer" : ""}</span>
                    </div>;
                  })}
                </div>
                <div className="report-answer-grid"><span>Your answer: <b>{userAnswer === undefined ? "Not answered" : String.fromCharCode(65 + userAnswer)}</b></span><span>Correct answer: <b>{correctAnswer >= 0 ? String.fromCharCode(65 + correctAnswer) : "Not verified"}</b></span></div>
                <p className="report-explanation"><strong>Explanation:</strong> {item.explanation || "No explanation provided."}</p>
                {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">View source</a>}
              </article>;
            })}
          </div>
        </section>
      )}
      {showExitDialog && quiz && (
        <div className="quiz-dialog-backdrop" role="presentation">
          <div className="quiz-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-test-title">
            <span className="eyebrow">TEST IN PROGRESS</span><h3 id="exit-test-title">Leave this test?</h3>
            <p>Your progress will be saved. You can resume while time remains.</p>
            <div><button type="button" className="button" onClick={() => setShowExitDialog(false)}>Stay in test</button><button type="button" className="button button-lime" onClick={exitAndSaveQuiz}>Exit & save</button></div>
          </div>
        </div>
      )}
      <section className="quiz-history panel quiz-history-card">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">MY PROGRESS</span>
            <h3>Recent attempts</h3>
          </div>
          <span className="muted">
            Scores remain available; reports expire after 30 days
          </span>
        </div>
        {history.length ? (
          <>
            <div className="history-controls">
              <label className="history-search">
                <Search size={15} />
                <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search attempts or topics" />
              </label>
              <select value={historyScoreFilter} onChange={(event) => setHistoryScoreFilter(event.target.value)} aria-label="Filter attempts by score">
                <option value="all">All scores</option>
                <option value="high">70% and above</option>
                <option value="needs-work">Below 70%</option>
              </select>
            </div>
            {visibleHistory.length ? visibleHistory.map((attempt) => (
            <div className="history-row" key={attempt.id}>
              <div>
                <span className="history-title">{attempt.quiz_title}</span>
                <div className="history-support">
                  <b>{attempt.score}%</b>
                  <small>{attempt.correct}/{attempt.total} correct</small>
                  <small>
                    {new Date(attempt.created_at).toLocaleDateString()}
                  </small>
                </div>
                <small className="history-strength">
                  Strong topics:{" "}
                  {attempt.strong_topics?.join(", ") || "Not enough data yet"}
                </small>
                <small className="history-topic-percentages">
                  Topic percentages:{" "}
                  {Object.entries(attempt.topic_scores || {})
                    .map(([topic, score]) => `${topic} ${score.percentage}%`)
                    .join(" · ") || "Not available"}
                </small>
              </div>
              {attempt.report_available && attempt.report ? (
                <div className="history-report">
                  <details>
                    <summary>View report</summary>
                    <p>{attempt.report}</p>
                    <small>
                      Available until{" "}
                      {attempt.report_expires_at
                        ? new Date(attempt.report_expires_at).toLocaleDateString()
                        : "30 days after the attempt"}
                      .
                    </small>
                  </details>
                  <button type="button" className="button button-small" onClick={() => void downloadHistoryReportPdf(attempt)} disabled={historyReportLoading}>
                    <Download size={14} /> {historyReportLoading ? "Preparing…" : "Download report PDF"}
                  </button>
                </div>
              ) : (
                <small className="history-report-expired">
                  Detailed report expired. Score, percentage, and strong topics
                  are still available.
                </small>
              )}
            </div>
            )) : <div className="sidebar-empty">No attempts match these filters.</div>}
            {historyPageCount > 1 && (
              <div className="history-pagination">
                <button type="button" className="button button-small" disabled={historyPage === 1} onClick={() => setHistoryPage((page) => page - 1)}><ChevronLeft size={15} /> Previous</button>
                <span>Page {historyPage} of {historyPageCount}</span>
                <button type="button" className="button button-small" disabled={historyPage === historyPageCount} onClick={() => setHistoryPage((page) => page + 1)}>Next <ChevronRight size={15} /></button>
              </div>
            )}
          </>
        ) : (
          <div className="sidebar-empty">
            Finish a quiz to start tracking your progress.
          </div>
        )}
      </section>
    </div>
  );
}

function JRFStrategyBuilder({ user }: { user: User | null }) {
  const [daysLeft, setDaysLeft] = useState(90);
  const [dailyHours, setDailyHours] = useState(4);
  const [paper2Subject, setPaper2Subject] = useState("");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [plan, setPlan] = useState<JRFStrategyPlan | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<JRFStrategyPlan | null>("/jrf-strategy")
      .then((saved) => {
        setPlan(saved);
        if (saved) {
          setDaysLeft(saved.days_left);
          setDailyHours(saved.daily_study_hours);
          setPaper2Subject(saved.paper_2_subject);
          setStartDate(saved.start_date);
          setMessage(
            saved.expiry_warning || "Your saved JRF strategy is ready.",
          );
        }
      })
      .catch((cause) => setMessage((cause as Error).message));
  }, [user]);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!paper2Subject.trim()) {
      setMessage("Enter your UGC NET Paper 2 subject.");
      return;
    }
    setLoading(true);
    setMessage("Generating your day-by-day UGC NET/JRF strategy with Groq…");
    try {
      const generated = await api<JRFStrategyPlan>("/jrf-strategy", {
        method: "POST",
        body: JSON.stringify({
          days_left: Number(daysLeft),
          daily_study_hours: Number(dailyHours),
          paper_2_subject: paper2Subject.trim(),
          start_date: startDate,
        }),
      });
      setPlan(generated);
      setMessage(
        `${generated.generated_by === "groq" ? "Groq generated" : "Fallback generated"} strategy saved. ${generated.expiry_warning || ""}`,
      );
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const openStrategyGuide = async (download: boolean) => {
    const popup = download
      ? null
      : window.open("about:blank", "_blank", "noopener,noreferrer");
    try {
      const blob = await apiBlob("/jrf-strategy/guide");
      const url = URL.createObjectURL(blob);
      if (popup) {
        popup.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = "PAPER_1_SECRET_STRATEGY.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      popup?.close();
      setMessage((cause as Error).message);
    }
  };

  if (!user)
    return (
      <div className="container">
        <div className="empty-state">
          <Sparkles size={28} />
          <h2>Build your JRF strategy.</h2>
          <p>
            Sign in to generate and save a personalized UGC NET/JRF roadmap.
          </p>
          <Link to="/login" className="button button-dark">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  const days = plan?.plan_data.days || [];
  return (
    <div className="container jrf-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">GROQ STUDY COACH</span>
          <h2>Custom JRF Study Strategy &amp; Timetable Builder</h2>
          <p className="muted">
            Get an AI-generated day-by-day roadmap tailored to your Paper 2 and
            exam schedule.
          </p>
        </div>
        <Sparkles size={26} />
      </div>
      {message && <div className="notice">{message}</div>}
      <section className="panel strategy-guide-card">
        <div>
          <span className="eyebrow">PAPER 1 REFERENCE GUIDE</span>
          <h3>Complete UGC NET Paper 1 Study Guide</h3>
          <p className="muted">
            Read the curated Paper 1 concepts, exam hacks, revision rules and
            exam-day strategy before generating your timetable.
          </p>
        </div>
        <div className="strategy-guide-actions">
          <button
            className="button button-dark button-small"
            type="button"
            onClick={() => void openStrategyGuide(false)}
          >
            View guide <ExternalLink size={14} />
          </button>
          <button
            className="button button-lime button-small"
            type="button"
            onClick={() => void openStrategyGuide(true)}
          >
            Download PDF <Download size={14} />
          </button>
        </div>
      </section>
      <div className="jrf-layout">
        <form className="panel jrf-builder" onSubmit={generate}>
          <div className="quiz-builder-head">
            <div>
              <span className="eyebrow">PLAN INPUTS</span>
              <h3>Set your preparation window</h3>
            </div>
            <CalendarDays size={23} />
          </div>
          <label>
            Days Left For Exam
            <input
              type="number"
              min={1}
              max={365}
              value={daysLeft}
              onChange={(event) =>
                setDaysLeft(
                  Math.max(1, Math.min(365, Number(event.target.value))),
                )
              }
              required
            />
          </label>
          <label>
            Daily Study Hours
            <input
              type="number"
              min={0.5}
              max={16}
              step={0.5}
              value={dailyHours}
              onChange={(event) =>
                setDailyHours(
                  Math.max(0.5, Math.min(16, Number(event.target.value))),
                )
              }
              required
            />
          </label>
          <label>
            Paper 2 Subject
            <input
              value={paper2Subject}
              onChange={(event) => setPaper2Subject(event.target.value)}
              placeholder="Political Science, Commerce, Education…"
              required
            />
          </label>
          <label>
            Plan Start Date
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </label>
          <button
            className="button button-lime"
            type="submit"
            disabled={loading}
          >
            {loading ? "Building strategy…" : "Generate My JRF Strategy Plan"}
            <Sparkles size={15} />
          </button>
          <small className="muted">
            The plan is saved to your account. It is automatically deleted two
            days after the final study date, and this page will warn you before
            expiry.
          </small>
        </form>
        <section className="panel jrf-result">
          {!plan ? (
            <div className="empty-state">
              <CalendarDays size={25} />
              <h3>Your roadmap will appear here.</h3>
              <p>
                Enter the three study details and generate a complete day-by-day
                plan.
              </p>
            </div>
          ) : (
            <>
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">
                    {plan.generated_by === "groq"
                      ? "GROQ GENERATED"
                      : "RELIABLE FALLBACK"}
                  </span>
                  <h3>
                    {plan.paper_2_subject} · {plan.days_left} days
                  </h3>
                  <small className="muted">
                    {plan.start_date} → {plan.last_date} ·{" "}
                    {plan.daily_study_hours} hours/day
                  </small>
                </div>
                <span className="status-pill">
                  <Check size={13} />
                  Saved
                </span>
              </div>
              {plan.expiry_warning && (
                <div className="notice jrf-expiry-warning">
                  {plan.expiry_warning}
                </div>
              )}
              {plan.plan_data.overview && (
                <p className="jrf-overview">{plan.plan_data.overview}</p>
              )}
              {!!plan.plan_data.weekly_strategy?.length && (
                <div className="jrf-weekly">
                  <span className="eyebrow">STRATEGY RULES</span>
                  {plan.plan_data.weekly_strategy.map((rule, index) => (
                    <div key={`${index}-${rule}`}>
                      <CheckCircle2 size={14} />
                      <span>{rule}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="jrf-days">
                <span className="eyebrow">DAY-BY-DAY ROADMAP</span>
                {days.map((day) => (
                  <article
                    className="jrf-day-card"
                    key={`${day.day_number}-${day.date}`}
                  >
                    <div className="jrf-day-head">
                      <div>
                        <b>
                          Day {day.day_number} ·{" "}
                          {new Date(`${day.date}T00:00:00`).toLocaleDateString(
                            undefined,
                            {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            },
                          )}
                        </b>
                        <small>{day.phase}</small>
                      </div>
                      <span>{day.mcq_target} MCQs</span>
                    </div>
                    <div className="jrf-focus">
                      <span>
                        <b>Paper 1</b>
                        {day.paper_1_focus}
                      </span>
                      <span>
                        <b>Paper 2</b>
                        {day.paper_2_focus}
                      </span>
                    </div>
                    <div className="jrf-sessions">
                      {day.sessions.map((session, index) => (
                        <div key={`${day.date}-${index}`}>
                          <time>
                            {session.start}–{session.end}
                          </time>
                          <span>{session.task}</span>
                          <small>{session.minutes} min</small>
                        </div>
                      ))}
                    </div>
                    <p>
                      <b>Deliverable:</b> {day.deliverable}
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function StudyPlanner({ user }: { user: User | null }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [title, setTitle] = useState("My UGC NET monthly plan");
  const [focusTopic, setFocusTopic] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState(60);
  const [selectedTopicIds, setSelectedTopicIds] = useState<number[]>([]);
  const [studyDays, setStudyDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [message, setMessage] = useState(
    "Select one course topic, or enter a particular topic when you create the plan.",
  );
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(`${month}-01`);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [blockTitle, setBlockTitle] = useState("");
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("10:00");
  const [blockTopicId, setBlockTopicId] = useState("");
  const [blockNotes, setBlockNotes] = useState("");
  const [blockSaving, setBlockSaving] = useState(false);

  const loadPlan = () =>
    api<StudyPlan[]>(`/study-plans?month=${encodeURIComponent(month)}`)
      .then((items) => {
        const saved = items[0] || null;
        setPlan(saved);
        if (saved?.focus_topic) setFocusTopic(saved.focus_topic);
      })
      .catch((cause) => setMessage((cause as Error).message));
  useEffect(() => {
    if (!user) return;
    api<Course[]>("/courses")
      .then(setCourses)
      .catch((cause) => setMessage((cause as Error).message));
  }, [user]);
  useEffect(() => {
    if (user) void loadPlan();
    setSelectedDate(`${month}-01`);
    setEditingItemId(null);
  }, [user, month]);
  const topics = courses.flatMap((course) =>
    course.modules.flatMap((module) =>
      module.topics.map((topic) => ({
        ...topic,
        courseTitle: course.title,
        moduleTitle: module.title,
      })),
    ),
  );
  const toggleDay = (day: number) =>
    setStudyDays((current) =>
      current.includes(day)
        ? current.filter((item) => item !== day)
        : [...current, day].sort(),
    );
  const toggleTopic = (id: number) =>
    setSelectedTopicIds((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      if (!focusTopic.trim() && next.length === 1) {
        const selected = topics.find((topic) => topic.id === next[0]);
        if (selected) setFocusTopic(selected.title);
      }
      return next;
    });
  const createPlan = async (event: FormEvent) => {
    event.preventDefault();
    const selectedFocus =
      focusTopic.trim() ||
      (selectedTopicIds.length === 1
        ? topics.find((topic) => topic.id === selectedTopicIds[0])?.title || ""
        : "");
    const requestedFocus =
      selectedFocus ||
      window
        .prompt(
          "Which particular UGC NET topic should this plan focus on?",
          "Teaching Aptitude",
        )
        ?.trim() ||
      "";
    if (!requestedFocus) {
      setMessage(
        "A particular topic is required; the planner will not create a generic plan.",
      );
      return;
    }
    setFocusTopic(requestedFocus);
    setSaving(true);
    try {
      const created = await api<StudyPlan>("/study-plans", {
        method: "POST",
        body: JSON.stringify({
          title,
          focus_topic: requestedFocus,
          month,
          daily_minutes: dailyMinutes,
          topic_ids: selectedTopicIds,
          study_days: studyDays,
        }),
      });
      setPlan(created);
      setSelectedDate(`${month}-01`);
      setMessage(
        `Topic-specific plan created for ${created.focus_topic}. Click any date to plan its 24 hours.`,
      );
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const completeItem = async (id: number, completed: boolean) => {
    try {
      const updated = await api<StudyPlan["items"][number]>(
        `/study-plans/items/${id}`,
        { method: "PATCH", body: JSON.stringify({ completed }) },
      );
      setPlan((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === id ? updated : item,
              ),
            }
          : current,
      );
    } catch (cause) {
      setMessage((cause as Error).message);
    }
  };
  const clockToMinute = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const minuteToClock = (value: number) =>
    `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const resetBlock = () => {
    setEditingItemId(null);
    setBlockTitle("");
    setBlockStart("09:00");
    setBlockEnd("10:00");
    setBlockTopicId("");
    setBlockNotes("");
  };
  const editBlock = (item: StudyPlan["items"][number]) => {
    setEditingItemId(item.id);
    setBlockTitle(item.title);
    setBlockStart(minuteToClock(item.start_minute ?? 540));
    setBlockEnd(minuteToClock(item.end_minute ?? 600));
    setBlockTopicId(item.topic_id ? String(item.topic_id) : "");
    setBlockNotes(item.notes || "");
  };
  const saveBlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!plan) return;
    const startMinute = clockToMinute(blockStart);
    const endMinute = clockToMinute(blockEnd);
    if (!blockTitle.trim() || endMinute <= startMinute) {
      setMessage(
        "Give the block a title and choose an end time after its start time.",
      );
      return;
    }
    setBlockSaving(true);
    try {
      const body = {
        study_date: selectedDate,
        title: blockTitle.trim(),
        topic_id: blockTopicId ? Number(blockTopicId) : null,
        start_minute: startMinute,
        end_minute: endMinute,
        duration_minutes: endMinute - startMinute,
        notes: blockNotes.trim(),
        sort_order: plan.items.filter(
          (item) => item.study_date === selectedDate,
        ).length,
      };
      const saved = await api<StudyPlan["items"][number]>(
        editingItemId
          ? `/study-plans/items/${editingItemId}`
          : `/study-plans/${plan.id}/items`,
        {
          method: editingItemId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
      setPlan((current) =>
        current
          ? {
              ...current,
              items: editingItemId
                ? current.items.map((item) =>
                    item.id === editingItemId ? saved : item,
                  )
                : [...current.items, saved],
            }
          : current,
      );
      resetBlock();
      setMessage(
        editingItemId
          ? "Study block updated."
          : "Study block added to this day.",
      );
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setBlockSaving(false);
    }
  };
  const notifications = useNotifications();

  const deleteBlock = async (id: number) => {
    const confirmed = await notifications.confirmAction({
      title: "Remove study block",
      message: "Remove this study block from your plan?",
      confirmLabel: "Remove block",
      destructive: true,
      onConfirm: async () => {
        await api(`/study-plans/items/${id}`, { method: "DELETE" });
        setPlan((current) =>
          current
            ? {
                ...current,
                items: current.items.filter((item) => item.id !== id),
              }
            : current,
        );
        if (editingItemId === id) resetBlock();
        setMessage("Study block removed.");
        notifications.showToast({
          kind: "success",
          title: "Study block removed",
          message: "The selected block was removed from your planner.",
        });
      },
    });
    if (!confirmed) return;
  };
  const [yearPart, monthPart] = month.split("-").map(Number);
  const daysInMonth = new Date(yearPart, monthPart, 0).getDate();
  const firstDayOffset =
    (new Date(yearPart, monthPart - 1, 1).getDay() + 6) % 7;
  const calendarDays = Array.from(
    { length: daysInMonth },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
  const selectedItems =
    plan?.items
      .filter((item) => item.study_date === selectedDate)
      .sort((a, b) => (a.start_minute ?? 540) - (b.start_minute ?? 540)) || [];
  const allTimelineHours = Array.from({ length: 24 }, (_, hour) => hour);
  if (!user)
    return (
      <div className="container">
        <div className="empty-state">
          <CalendarDays size={28} />
          <h2>Plan your preparation.</h2>
          <p>
            Sign in to create a personal daily schedule and track completed
            study blocks.
          </p>
          <Link to="/login" className="button button-dark">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  return (
    <div className="container planner-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PERSONAL STUDY PLANNER</span>
          <h2>Make the month count.</h2>
        </div>
        <span className="muted">Click any day to plan all 24 hours</span>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="planner-layout">
        <form className="planner-builder panel" onSubmit={createPlan}>
          <div className="quiz-builder-head">
            <div>
              <span className="eyebrow">PLAN SETUP</span>
              <h3>Build a monthly routine</h3>
            </div>
            <CalendarDays size={24} />
          </div>
          <label>
            Plan title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
          <label>
            Particular topic to study
            <input
              value={focusTopic}
              onChange={(event) => setFocusTopic(event.target.value)}
              placeholder="Teaching Aptitude, Political Science, Research Methodology…"
              required
            />
            <small className="muted">
              Every generated block will use this topic as its main focus.
            </small>
          </label>
          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              required
            />
          </label>
          <label>
            Default daily study time
            <select
              value={dailyMinutes}
              onChange={(event) => setDailyMinutes(Number(event.target.value))}
            >
              {[30, 45, 60, 90, 120, 180].map((value) => (
                <option key={value} value={value}>
                  {value} minutes
                </option>
              ))}
            </select>
          </label>
          <span className="eyebrow">STUDY DAYS FOR AUTO-PLANNING</span>
          <div className="chip-row">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
              (label, index) => (
                <button
                  type="button"
                  className={
                    studyDays.includes(index)
                      ? "filter-chip active"
                      : "filter-chip"
                  }
                  key={label}
                  onClick={() => toggleDay(index)}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <span className="eyebrow">TOPICS TO ROTATE</span>
          <div className="planner-topic-list">
            {topics.map((topic) => (
              <label className="topic-check" key={topic.id}>
                <input
                  type="checkbox"
                  checked={selectedTopicIds.includes(topic.id)}
                  onChange={() => toggleTopic(topic.id)}
                />
                <span>
                  <b>{topic.title}</b>
                  <small>
                    {topic.courseTitle} · {topic.moduleTitle}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <button
            className="button button-lime"
            type="submit"
            disabled={saving}
          >
            {saving ? "Creating plan…" : "Create monthly plan"}
            <CalendarDays size={15} />
          </button>
        </form>
        <section className="planner-calendar panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">{plan?.month || month}</span>
              <h3>{plan?.title || "Your schedule"}</h3>
            </div>
            {plan && (
              <span className="status-pill">
                <Check size={13} />
                {plan.items.filter((item) => item.completed).length}/
                {plan.items.length} complete
              </span>
            )}
          </div>
          {plan ? (
            <>
              <div className="planner-weekdays">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                  (day) => (
                    <span key={day}>{day}</span>
                  ),
                )}
              </div>
              <div className="planner-month-grid">
                {Array.from({ length: firstDayOffset }, (_, index) => (
                  <span
                    className="planner-calendar-blank"
                    key={`blank-${index}`}
                  />
                ))}
                {calendarDays.map((day) => {
                  const dayItems = plan.items.filter(
                    (item) => item.study_date === day,
                  );
                  return (
                    <button
                      type="button"
                      className={
                        selectedDate === day
                          ? "planner-day selected"
                          : dayItems.length
                            ? "planner-day has-items"
                            : "planner-day"
                      }
                      key={day}
                      onClick={() => {
                        setSelectedDate(day);
                        resetBlock();
                      }}
                    >
                      <b>{Number(day.slice(-2))}</b>
                      <small>
                        {dayItems.length
                          ? `${dayItems.length} block${dayItems.length === 1 ? "" : "s"}`
                          : "Plan day"}
                      </small>
                      {dayItems.some((item) => item.completed) && (
                        <Check size={12} />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="planner-day-heading">
                <div>
                  <span className="eyebrow">24-HOUR DAY PLAN</span>
                  <h3>
                    {new Date(`${selectedDate}T00:00:00`).toLocaleDateString(
                      undefined,
                      { weekday: "long", month: "long", day: "numeric" },
                    )}
                  </h3>
                </div>
                <span className="muted">
                  {selectedItems.length} scheduled block
                  {selectedItems.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="planner-day-layout">
                <div className="planner-timeline">
                  <div className="planner-time-labels">
                    {allTimelineHours.map((hour) => (
                      <span key={hour}>{minuteToClock(hour * 60)}</span>
                    ))}
                  </div>
                  <div className="planner-time-canvas">
                    {allTimelineHours.map((hour) => (
                      <span
                        className="planner-hour-line"
                        style={{ top: `${(hour / 24) * 100}%` }}
                        key={hour}
                      />
                    ))}
                    {selectedItems.map((item) => {
                      const start = item.start_minute ?? 540;
                      const end =
                        item.end_minute ??
                        Math.min(1440, start + item.duration_minutes);
                      return (
                        <button
                          type="button"
                          className={
                            item.completed
                              ? "planner-time-block completed"
                              : "planner-time-block"
                          }
                          style={{
                            top: `${(start / 1440) * 100}%`,
                            height: `${Math.max(2.2, ((end - start) / 1440) * 100)}%`,
                          }}
                          key={item.id}
                          onClick={() => editBlock(item)}
                        >
                          <b>
                            {minuteToClock(start)}–{minuteToClock(end)}
                          </b>
                          <span>{item.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="planner-day-side">
                  <form className="planner-block-form" onSubmit={saveBlock}>
                    <span className="eyebrow">
                      {editingItemId ? "EDIT TIME BLOCK" : "ADD TIME BLOCK"}
                    </span>
                    <label>
                      What will you do?
                      <input
                        value={blockTitle}
                        onChange={(event) => setBlockTitle(event.target.value)}
                        placeholder="Read, revise, practise…"
                        required
                      />
                    </label>
                    <div className="planner-time-inputs">
                      <label>
                        Start
                        <input
                          type="time"
                          value={blockStart}
                          onChange={(event) =>
                            setBlockStart(event.target.value)
                          }
                          required
                        />
                      </label>
                      <label>
                        End
                        <input
                          type="time"
                          value={blockEnd}
                          onChange={(event) => setBlockEnd(event.target.value)}
                          required
                        />
                      </label>
                    </div>
                    <label>
                      Topic
                      <select
                        value={blockTopicId}
                        onChange={(event) =>
                          setBlockTopicId(event.target.value)
                        }
                      >
                        <option value="">General study</option>
                        {topics.map((topic) => (
                          <option value={topic.id} key={topic.id}>
                            {topic.courseTitle} · {topic.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Notes
                      <textarea
                        value={blockNotes}
                        onChange={(event) => setBlockNotes(event.target.value)}
                        placeholder="What should be completed?"
                        rows={3}
                      />
                    </label>
                    <div className="planner-block-actions">
                      <button
                        className="button button-lime"
                        type="submit"
                        disabled={blockSaving}
                      >
                        {blockSaving
                          ? "Saving…"
                          : editingItemId
                            ? "Save changes"
                            : "Add to day"}
                        <Save size={14} />
                      </button>
                      {editingItemId && (
                        <button
                          className="button-link"
                          type="button"
                          onClick={resetBlock}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </form>
                  <div className="planner-day-list">
                    {selectedItems.length ? (
                      selectedItems.map((item) => (
                        <div
                          className={
                            item.completed
                              ? "planner-day-list-item completed"
                              : "planner-day-list-item"
                          }
                          key={item.id}
                        >
                          <input
                            type="checkbox"
                            checked={item.completed}
                            onChange={(event) =>
                              void completeItem(item.id, event.target.checked)
                            }
                          />
                          <span>
                            <b>
                              {minuteToClock(item.start_minute ?? 540)}–
                              {minuteToClock(item.end_minute ?? 600)} ·{" "}
                              {item.title}
                            </b>
                            <small>
                              {item.notes || `${item.duration_minutes} minutes`}
                            </small>
                          </span>
                          <button
                            className="button-link"
                            type="button"
                            onClick={() => editBlock(item)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="button-link button-danger"
                            type="button"
                            onClick={() => void deleteBlock(item.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="sidebar-empty">
                        No blocks yet. Add one for this day.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <CalendarDays size={24} />
              <h3>No plan for this month.</h3>
              <p>
                Select topics and study days, then create your monthly schedule.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function About() {
  return (
    <div className="container about-page">
      <section className="mentor-hero panel">
        <div className="mentor-hero-copy">
          <span className="eyebrow">ABOUT YOUR MENTOR</span>
          <h1>Meet your mentor.</h1>
          <h2>Learn from experience, guidance and exam-focused strategy.</h2>
          <p>
            Amit Mehra is the lead mentor for the AAGAZ programme and a UGC NET
            (JRF) qualified educator. He brings classroom experience,
            examination insight and research-led pedagogy to Paper 1
            preparation, helping learners convert understanding into exam
            performance.
          </p>
        </div>
      </section>

      <section className="mentor-profile-block">
        <div className="mentor-profile-card panel">
          <div className="mentor-profile-image-wrap">
            <img
              src="/dist/assets/image1.jpeg"
              alt="Amit Mehra"
              className="mentor-image"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          </div>

          <div className="mentor-profile-main">
            <span className="eyebrow subtle">Mentor profile</span>
            <h2>Amit Mehra</h2>
            <p className="mentor-role">Lead Mentor</p>
            <p className="mentor-summary">
              Amit Mehra is the lead mentor for the AAGAZ programme and a UGC NET
              (JRF) qualified educator. He brings classroom experience,
              examination insight and research-led pedagogy to Paper 1
              preparation, helping learners convert understanding into exam
              performance.
            </p>

            <div className="mentor-divider" />

            <div className="mentor-detail-group">
              <div className="mentor-detail-item">
                <span className="mentor-detail-label">🎓 Education</span>
                <ul>
                  <li>MA History – Delhi University</li>
                  <li>MA Political Science</li>
                  <li>BA (Hons.) History – Ramjas College, Delhi University</li>
                </ul>
              </div>

              <div className="mentor-detail-item">
                <span className="mentor-detail-label">🏆 Experience / Results</span>
                <ul>
                  <li>Twice UGC NET JRF Qualified</li>
                  <li>Scored 70+ Marks in Paper 1</li>
                  <li>Lead mentor for the AAGAZ programme</li>
                </ul>
              </div>
            </div>

            <div className="mentor-actions">
              <a className="button button-dark" href="mailto:mehraamit1784@gmail.com">
                Contact Mentor
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="mentor-credentials-block">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Credentials</span>
            <h2>Academic and exam strengths</h2>
          </div>
        </div>

        <div className="mentor-credential-grid">
          <div className="mentor-credential-card">
            <span className="credential-icon">🎓</span>
            <span className="credential-title">Education</span>
            <p>MA History – Delhi University, MA Political Science, BA (Hons.) History – Ramjas College, Delhi University.</p>
          </div>

          <div className="mentor-credential-card">
            <span className="credential-icon">🏆</span>
            <span className="credential-title">UGC NET / JRF</span>
            <p>Twice UGC NET JRF qualified, bringing research-led insight and exam strategy to Paper 1 preparation.</p>
          </div>

          <div className="mentor-credential-card">
            <span className="credential-icon">📚</span>
            <span className="credential-title">Teaching Experience</span>
            <p>Lead mentor for the AAGAZ programme with classroom experience and a focus on practical, exam-oriented learning.</p>
          </div>

          <div className="mentor-credential-card">
            <span className="credential-icon">🎯</span>
            <span className="credential-title">Exam Preparation</span>
            <p>Scored 70+ Marks in Paper 1 and translates that performance into actionable study guidance.</p>
          </div>
        </div>
      </section>

      <section className="mentor-connect-block">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Connect</span>
            <h2>Connect with the mentor</h2>
          </div>
        </div>

        <div className="mentor-connect-grid">
          <a href="mailto:mehraamit1784@gmail.com" className="mentor-connect-card" target="_self" rel="noreferrer">
            <span className="mentor-connect-icon">✉</span>
            <span>Email</span>
          </a>
          <a href="https://wa.me/919053474768" className="mentor-connect-card" target="_blank" rel="noreferrer">
            <span className="mentor-connect-icon">💬</span>
            <span>WhatsApp</span>
          </a>
          <a href="https://t.me/jrfhunters" className="mentor-connect-card" target="_blank" rel="noreferrer">
            <span className="mentor-connect-icon">✈</span>
            <span>Telegram</span>
          </a>
          <a href="https://www.instagram.com/jrfhunters/" className="mentor-connect-card" target="_blank" rel="noreferrer">
            <span className="mentor-connect-icon">◎</span>
            <span>Instagram</span>
          </a>
          <a href="https://www.youtube.com/@AMITMEHRADU" className="mentor-connect-card" target="_blank" rel="noreferrer">
            <span className="mentor-connect-icon">▶</span>
            <span>YouTube</span>
          </a>
        </div>
      </section>
    </div>
  );
}

type QuestionPreview = {
  question: string;
  options: string[];
  answer?: string | number | null;
  explanation?: string | null;
  year?: string | number | null;
  topic?: string | null;
};

function libraryFileSize(value?: number | null) {
  if (!value) return "Size unavailable";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getLibraryFileType(name: string) {
  const ext = name.split(".").pop()?.toUpperCase() || "FILE";
  return ext === "JS" ? "JS" : ext === "JSON" ? "JSON" : ext === "PDF" ? "PDF" : ext === "DOCX" ? "DOCX" : ext === "DOC" ? "DOC" : ext === "XLSX" || ext === "XLS" ? "XLS" : ext === "PPT" || ext === "PPTX" ? "PPT" : ext === "ZIP" ? "ZIP" : ext;
}

function getLibraryCategory(file: QuestionLibraryFile) {
  const normalized = file.name.toLowerCase();
  if (file.is_answer_key || normalized.includes("answer") || normalized.includes("key")) return "Answer Key";
  if (file.is_question_file || normalized.includes("question") || normalized.includes("paper")) return "Question Paper";
  if (normalized.includes("merged") || normalized.includes("combined") || normalized.includes("final")) return "Merged Paper";
  return "Other";
}

function QuestionBankPage({ user }: { user: User | null }) {
  const [access, setAccess] = useState<PremiumAccess | null>(null);
  const [library, setLibrary] = useState<QuestionLibrary | null>(null);
  const [preview, setPreview] = useState<{
    file: QuestionLibraryFile;
    questions: QuestionPreview[];
    count: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});
  const load = () => {
    setLoading(true);
    setError("");
    void Promise.allSettled([
      api<PremiumAccess>("/payments/status"),
      api<QuestionLibrary>("/library/question-bank"),
    ])
      .then(([paymentResult, archiveResult]) => {
        if (paymentResult.status === "fulfilled")
          setAccess(paymentResult.value);
        if (archiveResult.status === "fulfilled")
          setLibrary(archiveResult.value);
        const failure =
          archiveResult.status === "rejected"
            ? archiveResult.reason
            : paymentResult.status === "rejected"
              ? paymentResult.reason
              : null;
        if (failure)
          setError(
            (failure as Error).message ||
              "Could not load the question archive.",
          );
      })
      .finally(() => setLoading(false));
  };
  const fileTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (library?.files ?? []).map((file) => getLibraryFileType(file.name)),
        ),
      ).sort(),
    [library],
  );

  const yearOptions = useMemo(
    () =>
      (library?.years ?? []).map((group) =>
        group.year === "Other" ? "Other" : String(group.year),
      ),
    [library],
  );

  useEffect(() => {
    if (library) {
      setExpandedYears((current) => {
        const next = { ...current };
        for (const group of library.years) {
          const yearKey = group.year === "Other" ? "Other" : String(group.year);
          next[yearKey] = current[yearKey] ?? true;
        }
        return next;
      });
    }
  }, [library]);

  const visibleYears = useMemo(() => {
    if (!library) return [];
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return library.years
      .map((group) => {
        const yearKey = group.year === "Other" ? "Other" : String(group.year);
        const filteredFiles = group.files.filter((file) => {
          const fileType = getLibraryFileType(file.name);
          const category = getLibraryCategory(file);
          const matchesSearch =
            !normalizedQuery ||
            `${file.name} ${file.relative_path}`.toLowerCase().includes(normalizedQuery);
          const matchesYear =
            yearFilter === "all" ||
            (yearFilter === "Other" && group.year === "Other") ||
            String(group.year) === yearFilter;
          const matchesType = typeFilter === "all" || fileType === typeFilter;
          const matchesCategory =
            categoryFilter === "all" || category === categoryFilter;
          return matchesSearch && matchesYear && matchesType && matchesCategory;
        });

        return {
          ...group,
          yearKey,
          filteredFiles,
        };
      })
      .filter((group) => group.filteredFiles.length > 0);
  }, [library, searchQuery, yearFilter, typeFilter, categoryFilter]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    load();
  }, [user]);
  const openPreview = async (file: QuestionLibraryFile) => {
    if (preview?.file.id === file.id) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setError("");
    try {
      const data = await api<{
        file: QuestionLibraryFile;
        questions: QuestionPreview[];
        question_count: number;
      }>(`/library/question-bank/file/${encodeURIComponent(file.id)}`);
      setPreview({
        file: data.file,
        questions: data.questions,
        count: data.question_count,
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  };
  const downloadQuestionFile = async (file: QuestionLibraryFile) => {
    try {
      const blob = await apiBlob(
        `/library/question-bank/file/${encodeURIComponent(file.id)}/download`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        (cause as Error).message || "Could not download the question file.",
      );
    }
  };
  const openQuestionInDrive = async (file: QuestionLibraryFile) => {
    try {
      const result = await api<{ url: string }>(`/library/question-bank/file/${encodeURIComponent(file.id)}/drive-view`, { method: "POST" });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (cause) { setError((cause as Error).message || "Google Drive access could not be granted."); }
  };
  if (!user)
    return (
      <div className="container">
        <div className="empty-state">
          <LogIn size={26} />
          <h2>Sign in to open the archive.</h2>
          <p>
            The question library is connected to the protected learner area.
          </p>
          <Link to="/login" className="button button-dark">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  return (
    <div className="container library-page">
      <section className="library-hero panel panel-olive">
        <div>
          <span className="eyebrow">JRF HUNTERS ARCHIVE</span>
          <h1>
            Previous-year questions,
            <br />
            <em>properly organised.</em>
          </h1>
          <p>
            Browse the private question archive by year. Original filenames
            and answer-key files remain available through protected downloads.
          </p>
        </div>
        {!library?.premium_required && (
          <span className="library-lock-badge">
            <ShieldCheck size={15} /> Backend protected
          </span>
        )}
      </section>
      {error && (
        <div className="notice notice-inline" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="notice-inline-close"
            aria-label="Dismiss error message"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {loading ? (
        <div className="empty-state">Loading the question archive…</div>
      ) : library?.premium_required ? (
        <PremiumPaywall access={access} feature="library" onPaid={load} />
      ) : !library?.files.length ? (
        <div className="empty-state">
          <FileText size={25} />
          <h3>No question files found.</h3>
          <p>
            Check that the configured Drive folder is shared with the backend
            OAuth account.
          </p>
        </div>
      ) : (
        <>
          <div className="archive-toolbar">
            <label className="archive-search">
              <span className="archive-search-icon">
                <FileText size={14} />
              </span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by title or path"
              />
            </label>
            <div className="archive-filter-group">
              <label>
                <span>Year</span>
                <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
                  <option value="all">All years</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year === "Other" ? "Other" : `UGC NET ${year}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Type</span>
                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                  <option value="all">All files</option>
                  {fileTypeOptions.map((typeValue) => (
                    <option key={typeValue} value={typeValue}>
                      {typeValue}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Category</span>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="all">All categories</option>
                  <option value="Question Paper">Question Paper</option>
                  <option value="Answer Key">Answer Key</option>
                  <option value="Merged Paper">Merged Paper</option>
                  <option value="Other">Other</option>
                </select>
              </label>
            </div>
          </div>
          <div className="library-stats">
            <span>
              <b>{library.file_count}</b>
              <small>files</small>
            </span>
            <span>
              <b>{library.years.length}</b>
              <small>year groups</small>
            </span>
            <span>
              <b>JSON · JS · PDF</b>
              <small>formats</small>
            </span>
          </div>
          {visibleYears.length === 0 ? (
            <div className="empty-state archive-empty-state">
              <FileText size={24} />
              <h3>No files match these filters.</h3>
              <p>Try a different search phrase, year, or file type.</p>
            </div>
          ) : (
            <div className="archive-year-list">
              {visibleYears.map((group) => {
                const isExpanded = expandedYears[group.yearKey] ?? true;
                return (
                  <section className="archive-year" key={group.yearKey}>
                    <div className="archive-year-heading">
                      <button
                        type="button"
                        className="archive-year-toggle"
                        onClick={() =>
                          setExpandedYears((current) => ({
                            ...current,
                            [group.yearKey]: !(current[group.yearKey] ?? true),
                          }))
                        }
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <div>
                        <span className="eyebrow">QUESTION ARCHIVE</span>
                        <h2>
                          {group.year === "Other"
                            ? "Other source files"
                            : `UGC NET ${group.year}`}
                        </h2>
                      </div>
                      <span className="status-pill archive-year-count">
                        {group.filteredFiles.length} files
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="archive-file-list">
                        {group.filteredFiles.map((file) => {
                          const fileType = getLibraryFileType(file.name);
                          const category = getLibraryCategory(file);
                          return (
                            <article className="archive-file" key={file.id}>
                              <span className={`archive-file-icon ${file.is_answer_key ? "answer-key" : ""}`}>
                                {file.is_answer_key ? (
                                  <CheckCircle2 size={17} />
                                ) : (
                                  <FileText size={17} />
                                )}
                              </span>
                              <div className="archive-file-main">
                                <div className="archive-file-title-row">
                                  <b>{file.name}</b>
                                  <span className="file-type-badge">{fileType}</span>
                                </div>
                                <div className="archive-file-meta">
                                  <span>{file.relative_path}</span>
                                  <span>{libraryFileSize(file.size)}</span>
                                  <span>{category}</span>
                                </div>
                              </div>
                              <div className="archive-file-actions">
                                {file.is_question_file && (
                                  <button
                                    className="button button-small"
                                    type="button"
                                    disabled={previewLoading}
                                    onClick={() => void openPreview(file)}
                                  >
                                    {preview?.file.id === file.id
                                      ? "Close preview"
                                      : previewLoading
                                        ? "Reading…"
                                        : "Preview"}
                                  </button>
                                )}
                                <button
                                  className="button button-small button-lime"
                                  type="button"
                                  onClick={() => void downloadQuestionFile(file)}
                                >
                                  Download <Download size={12} />
                                </button>
                                <button
                                  className="button button-small button-outline"
                                  type="button"
                                  onClick={() => void openQuestionInDrive(file)}
                                >
                                  Open in Drive <ExternalLink size={12} />
                                </button>
                              </div>
                              {preview?.file.id === file.id && (
                                <div className="question-preview">
                                  <div className="question-preview-head">
                                    <span>
                                      <b>{preview.count || "No"} questions detected</b>
                                      <small>
                                        Parsed from the original file; download the
                                        protected source for the complete file.
                                      </small>
                                    </span>
                                    <button
                                      type="button"
                                      className="question-preview-close"
                                      onClick={() => setPreview(null)}
                                      aria-label="Close preview"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                  {preview.questions.length ? (
                                    preview.questions.map((question, index) => (
                                      <div
                                        className="question-preview-row"
                                        key={`${file.id}-${index}`}
                                      >
                                        <b>
                                          {index + 1}. {question.question}
                                        </b>
                                        <div>
                                          {question.options.map(
                                            (option, optionIndex) => (
                                              <span
                                                key={`${file.id}-${index}-${optionIndex}`}
                                              >
                                                <i>
                                                  {String.fromCharCode(
                                                    65 + optionIndex,
                                                  )}
                                                </i>
                                                {option}
                                              </span>
                                            ),
                                          )}
                                        </div>
                                        {question.answer !== undefined &&
                                          question.answer !== null && (
                                            <small className="answer-label">
                                              Answer key: {String(question.answer)}
                                            </small>
                                          )}
                                        {question.explanation && (
                                          <small>{question.explanation}</small>
                                        )}
                                      </div>
                                    ))
                                  ) : (
                                    <p className="muted">
                                      This file is available in Drive, but its format
                                      could not be safely previewed here.
                                    </p>
                                  )}
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecordedVideoLibraryPage({ user }: { user: User | null }) {
  const [access, setAccess] = useState<PremiumAccess | null>(null);
  const [library, setLibrary] = useState<RecordedLibrary | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "alpha">("newest");

  const stats = useMemo(() => {
    const items = library?.items ?? [];
    const latest = [...items].sort((a, b) => {
      const left = a.recorded_at ? Date.parse(a.recorded_at) : 0;
      const right = b.recorded_at ? Date.parse(b.recorded_at) : 0;
      return right - left;
    })[0];

    return {
      total: items.length,
      latestLabel: latest
        ? latest.recorded_at
          ? new Date(latest.recorded_at).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "Unavailable"
        : "No recordings",
      latestTitle: latest?.meeting_name || latest?.display_name || latest?.name || "No recordings",
      resources: items.filter((item) => Boolean(item.play_url || item.download_url)).length,
    };
  }, [library]);

  const visibleItems = useMemo(() => {
    const items = library?.items ?? [];
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filtered = normalizedQuery
      ? items.filter((item) => {
          const chunk = `${item.display_name ?? ""} ${item.meeting_name ?? ""} ${item.name ?? ""} ${item.session_label ?? ""}`.toLowerCase();
          return chunk.includes(normalizedQuery);
        })
      : items;

    return [...filtered].sort((a, b) => {
      if (sortBy === "alpha") {
        return (a.display_name || a.name).localeCompare(b.display_name || b.name);
      }
      const left = a.recorded_at ? Date.parse(a.recorded_at) : 0;
      const right = b.recorded_at ? Date.parse(b.recorded_at) : 0;
      return sortBy === "oldest" ? left - right : right - left;
    });
  }, [library, searchQuery, sortBy]);

  const load = () => {
    setLoading(true);
    setError("");
    void Promise.allSettled([
      api<PremiumAccess>("/payments/status"),
      api<RecordedLibrary>("/library/recorded-videos"),
    ])
      .then(([paymentResult, videosResult]) => {
        if (paymentResult.status === "fulfilled")
          setAccess(paymentResult.value);
        if (videosResult.status === "fulfilled") setLibrary(videosResult.value);
        const failure =
          videosResult.status === "rejected"
            ? videosResult.reason
            : paymentResult.status === "rejected"
              ? paymentResult.reason
              : null;
        if (failure)
          setError(
            (failure as Error).message ||
              "Could not load the recorded classroom.",
          );
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user]);
  if (!user)
    return (
      <div className="container">
        <div className="empty-state">
          <LogIn size={26} />
          <h2>Sign in to view recorded classes.</h2>
          <p>Recordings are available inside the protected learner library.</p>
          <Link to="/login" className="button button-dark">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  return (
    <div className="container library-page">
      <section className="library-hero library-hero-dark panel recorded-hero">
        <div className="recorded-hero-copy">
          <span className="eyebrow">PREMIUM CLASSROOM</span>
          <h1>
            Recorded classes,
            <br />
            <em>one day at a time.</em>
          </h1>
          <p>
            Return to previously taught live sessions with secure playback, without
            exposing any raw Drive links or admin-only storage details.
          </p>
        </div>
        <div className="recorded-hero-aside">
          <div className="recorded-hero-visual" aria-hidden="true">
            <div className="recorded-visual-window">
              <span className="recorded-visual-badge">Recording</span>
              <span className="recorded-visual-play">
                <Play size={18} />
              </span>
              <span className="recorded-visual-line line-short" />
              <span className="recorded-visual-line line-long" />
              <span className="recorded-visual-line line-mid" />
            </div>
          </div>
          <span className="library-lock-badge">
            <ShieldCheck size={15} /> Secure playback
          </span>
        </div>
      </section>

      <div className="library-stats recorded-stats">
        <div className="stat-card">
          <span className="stat-label">Total recordings</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Latest class</span>
          <strong title={stats.latestTitle}>{stats.latestTitle}</strong>
          <small>{stats.latestLabel}</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Available to watch</span>
          <strong>{stats.resources}</strong>
          <small>Protected playback</small>
        </div>
      </div>

      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="empty-state">Loading the recorded classroom…</div>
      ) : !library || library.premium_required ? (
        <PremiumPaywall access={access} feature="library" onPaid={load} />
      ) : !visibleItems.length ? (
        <div className="empty-state">
          <Play size={25} />
          <h3>No recordings match your search.</h3>
          <p>Try a different class name or topic to find a recording.</p>
        </div>
      ) : (
        <>
          <div className="recordings-toolbar">
            <label className="recordings-search">
              <span className="recordings-search-icon">
                <Play size={14} />
              </span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search recordings..."
              />
            </label>
            <label className="recordings-sort">
              <span>Sort</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="alpha">A–Z</option>
              </select>
            </label>
          </div>

          <div className="recorded-library-header">
            <div>
              <span className="eyebrow subtle">RECORDED CLASSES</span>
              <h2>Continue learning from earlier live sessions.</h2>
            </div>
          </div>

          <section className="recorded-library-grid">
            {visibleItems.map((item) => {
              const meetingName =
                item.meeting_name?.trim() ||
                item.display_name?.trim() ||
                item.name?.trim() ||
                "Recorded class";
              const originalName = item.name || item.display_name || "Recorded class";

              return (
                <article
                  className={`recorded-library-card ${playingId === item.id ? "playing" : ""}`}
                  key={item.id}
                >
                  {playingId === item.id ? (
                    <video
                      className="recorded-library-player"
                      src={item.play_url}
                      controls
                      autoPlay
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <button
                      className="recorded-library-cover"
                      type="button"
                      onClick={() => setPlayingId(item.id)}
                      aria-label={`Play recording: ${meetingName}`}
                    >
                      <span className="recorded-play">
                        <Play size={19} />
                      </span>
                      <span className="recorded-cover-copy">{meetingName}</span>
                    </button>
                  )}
                  <div className="recorded-library-copy">
                    <div className="recorded-library-head">
                      <span className="recording-tag">
                        <span className="dot" /> LIVE CLASS · {item.recorded_at ? new Date(item.recorded_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : item.session_label || "Recorded class"}
                      </span>
                      <h3>{meetingName}</h3>
                    </div>

                    <div className="recorded-library-meta">
                      <span>
                        <CalendarDays size={12} />
                        {item.recorded_at
                          ? new Date(item.recorded_at).toLocaleString("en-IN", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "Recording date unavailable"}
                      </span>
                      <span>
                        <Clock3 size={12} />
                        {item.day_number ? `Day ${item.day_number}` : item.session_label || "Session"}
                      </span>
                    </div>

                    <div className="recorded-library-actions">
                      <button
                        className="button button-small button-dark"
                        type="button"
                        onClick={() => setPlayingId(item.id)}
                      >
                        <Play size={13} /> Watch recording
                      </button>
                      <a className="button button-small" href={item.download_url}>
                        Download <Download size={13} />
                      </a>
                    </div>

                    <small className="recording-original-name" title={originalName}>
                      {originalName}
                    </small>
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

function ContactPage() {
  return (
    <div className="container contact-page">
      <section className="contact-hero panel panel-olive">
        <div>
          <span className="eyebrow">CONTACT & COMMUNITY</span>
          <h1>
            Stay close to the
            <br />
            <em>JRF Hunters</em> circle.
          </h1>
          <p>
            Questions about a course, payment, live class, or your study plan?
            Reach the team directly or join the community channels for updates
            and exam-focused guidance.
          </p>
        </div>
        <div className="contact-hero-badge">
          <Users size={21} />
          <span>
            <b>Learn together.</b>
            <small>Ask · practise · improve</small>
          </span>
        </div>
      </section>
      <section className="contact-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">DIRECT SUPPORT</span>
            <h2>Choose the channel that works for you.</h2>
          </div>
          <span className="muted">
            Usually best to include your registered email and payment ID.
          </span>
        </div>
        <div className="contact-grid">
          <a className="contact-card" href="mailto:mehraamit1784@gmail.com">
            <span className="contact-card-icon">
              <Mail size={18} />
            </span>
            <span>
              <b>Email support</b>
              <small>mehraamit1784@gmail.com</small>
              <em>Course, account and payment help</em>
            </span>
            <ArrowRight size={15} />
          </a>
          <a
            className="contact-card"
            href="https://wa.me/919053474768"
            target="_blank"
            rel="noreferrer"
          >
            <span className="contact-card-icon">
              <MessageCircle size={18} />
            </span>
            <span>
              <b>WhatsApp</b>
              <small>+91 9053474768</small>
              <em>Quick learner support</em>
            </span>
            <ExternalLink size={14} />
          </a>
          <a className="contact-card" href="tel:+919053474768">
            <span className="contact-card-icon">
              <Phone size={18} />
            </span>
            <span>
              <b>Call support</b>
              <small>+91 9053474768</small>
              <em>For urgent access issues</em>
            </span>
            <ArrowRight size={15} />
          </a>
        </div>
      </section>
      <section className="community-panel">
        <div>
          <span className="eyebrow">JRF HUNTERS COMMUNITY</span>
          <h2>Keep the momentum between classes.</h2>
          <p>
            Join the public channels for strategy notes, live-class
            announcements, demo sessions and reminders. Official support and
            payment issues should still be sent by email so they can be tracked.
          </p>
        </div>
        <div className="community-links">
          <a href="https://t.me/jrfhunters" target="_blank" rel="noreferrer">
            <Send size={16} />
            <span>
              <b>Telegram Channel</b>
              <small>t.me/jrfhunters</small>
            </span>
            <ExternalLink size={13} />
          </a>
          <a
            href="https://www.instagram.com/jrfhunters/"
            target="_blank"
            rel="noreferrer"
          >
            <Sparkles size={16} />
            <span>
              <b>Instagram</b>
              <small>@jrfhunters</small>
            </span>
            <ExternalLink size={13} />
          </a>
          <a
            href="https://www.youtube.com/@AMITMEHRADU"
            target="_blank"
            rel="noreferrer"
          >
            <Play size={16} />
            <span>
              <b>YouTube Channel</b>
              <small>@AMITMEHRADU</small>
            </span>
            <ExternalLink size={13} />
          </a>
        </div>
      </section>
      <div className="contact-trust">
        <ShieldCheck size={18} />
        <span>
          <b>Need a payment or course resolution?</b>
          <small>
            Use the grievance process for a formal complaint. Our policies
            explain access, refunds, privacy and acceptable use before you buy.
          </small>
        </span>
        <Link className="button button-dark button-small" to="/grievances">
          Open grievance desk <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

type LegalPageKind = "terms" | "privacy" | "refunds" | "grievances";

function LegalPage({ page }: { page: LegalPageKind }) {
  const title =
    page === "terms"
      ? "Terms & Conditions"
      : page === "privacy"
        ? "Privacy Policy"
        : page === "refunds"
          ? "Refund & Cancellation Rules"
          : "Grievance Redressal";
  const label =
    page === "terms"
      ? "TERMS OF USE"
      : page === "privacy"
        ? "YOUR PRIVACY"
        : page === "refunds"
          ? "PAYMENT PROTECTION"
          : "SUPPORT & RESOLUTION";
  return (
    <div className="container legal-page">
      <div className="legal-hero">
        <span className="eyebrow">{label}</span>
        <h1>{title}</h1>
        <p>JRF HUNTERS Learning Studio · JRF Hunters</p>
        <small>Last updated: 14 September 2026</small>
      </div>
      <article className="legal-card">
        {page === "terms" && (
          <>
            <h2>1. About these terms</h2>
            <p>
              These terms govern your use of the JRF HUNTERS Learning Studio website,
              courses, mock tests, live classes, study tools and related digital
              resources. By creating an account, enrolling in a course, or using
              a paid feature, you agree to these terms.
            </p>
            <h2>2. Accounts and learner access</h2>
            <p>
              You must provide accurate information, keep your password and
              verification codes private, and use one personal account. Course
              access is linked to the account that completed enrollment and may
              not be transferred, shared, resold, or used for group access
              without written permission.
            </p>
            <h2>3. Courses, batches and access periods</h2>
            <p>
              Each course page displays its current price, included features,
              launch information and access duration. Access begins after
              successful payment verification or free enrollment and ends on the
              date shown for that course. Scheduled dates, faculty, lesson order
              and included resources may be updated to improve delivery;
              material changes will be communicated through the available
              account channels.
            </p>
            <h2>4. Payments and receipts</h2>
            <p>
              Payments are processed through Razorpay. JRF HUNTERS does not store your
              full card, UPI or banking credentials. A receipt and enrollment
              status are created only after server-side payment verification. Do
              not make a second payment while an earlier transaction is still
              pending; contact support with the order or payment ID first.
            </p>
            <h2>5. Digital content and intellectual property</h2>
            <p>
              Videos, recordings, PDFs, question banks, notes, logos, course
              structure and software are provided for your personal learning.
              You may view and download resources only where the interface
              permits it. Copying, scraping, recording, redistributing, selling,
              uploading to public groups, or claiming the material as your own
              is prohibited.
            </p>
            <h2>6. Live classes, recordings and community channels</h2>
            <p>
              Live sessions depend on the published schedule and the
              availability of supported services such as Google Meet. Recordings
              may be added after a session, subject to recording quality and
              storage availability. Community channels are for learning and
              announcements; harassment, spam, impersonation and unauthorised
              promotion are not allowed.
            </p>
            <h2>7. AI-assisted features</h2>
            <p>
              AI tools may help explain concepts, generate study plans, or
              answer syllabus-focused questions. They are learning aids and are
              not a replacement for official notifications, textbooks, legal
              advice, medical advice or examination authorities. Do not submit
              passwords, payment credentials or sensitive personal information
              to an AI prompt.
            </p>
            <h2>8. Acceptable use and suspension</h2>
            <p>
              We may restrict or suspend access for credential sharing, payment
              abuse, unlawful use, content piracy, harassment, security attacks,
              or material breach of these terms. Where appropriate, we will
              preserve relevant payment and account records for fraud prevention
              and dispute handling.
            </p>
            <h2>9. Contact</h2>
            <p>
              For questions about these terms, write to{" "}
              <a href="mailto:mehraamit1784@gmail.com">
                mehraamit1784@gmail.com
              </a>
              . These terms do not remove rights that cannot legally be waived
              under applicable Indian law.
            </p>
          </>
        )}
        {page === "privacy" && (
          <>
            <h2>1. What we collect</h2>
            <p>
              We collect the information needed to operate the learning service:
              name, email address, account credentials in hashed form, course
              enrollments, quiz attempts, study plans, support messages and
              basic device or access logs. Payment providers return transaction
              identifiers and status; JRF HUNTERS does not receive or store your full
              card, UPI PIN or banking password.
            </p>
            <h2>2. How we use it</h2>
            <p>
              We use data to authenticate learners, deliver course access,
              process payments, send verification or service emails, provide
              live classes and recordings, protect the platform, answer support
              requests, and show learning progress. Quiz and study activity may
              be used to generate your own reports and recommendations.
            </p>
            <h2>3. Service providers</h2>
            <p>
              Some features use specialist providers: Razorpay for payment
              processing, Google services for authorised Meet, Calendar or Drive
              workflows, Groq for configured AI responses, and SMTP providers
              for account email. Information is sent to a provider only when
              required for the feature you use and according to that provider’s
              terms and privacy practices.
            </p>
            <h2>4. Images, prompts and AI</h2>
            <p>
              If you use the AI Lab, the text, selected image and related
              question may be sent to the configured AI provider to produce an
              answer. Avoid uploading confidential documents, identity
              documents, passwords or payment information. AI responses may be
              retained by the provider according to its applicable policies.
            </p>
            <h2>5. Security</h2>
            <p>
              Passwords are stored as one-way hashes. Verification and reset
              codes are stored only as hashes, expire, and are rate-limited.
              Access tokens, payment secrets and provider credentials are
              handled server-side. No online system can promise absolute
              security, so keep your account credentials private and report
              suspicious activity promptly.
            </p>
            <h2>6. Retention and your choices</h2>
            <p>
              We retain account, enrollment, payment and support records for as
              long as needed to provide the service, meet legal or accounting
              obligations, resolve disputes and prevent fraud. You may request
              account or data-related assistance through{" "}
              <a href="mailto:mehraamit1784@gmail.com">
                mehraamit1784@gmail.com
              </a>
              . Some records may need to be retained where required by law or
              legitimate security purposes.
            </p>
            <h2>7. Cookies and local storage</h2>
            <p>
              The learner app uses browser storage for your sign-in token
              according to the “Remember me” choice. Clearing site storage signs
              you out on that device. We do not use your learning activity to
              sell personal advertising profiles.
            </p>
            <h2>8. Updates</h2>
            <p>
              We may update this policy when the service or legal requirements
              change. The latest version is posted on this page with its update
              date.
            </p>
          </>
        )}
        {page === "refunds" && (
          <>
            <h2>1. Payment confirmation</h2>
            <p>
              Course access is activated only after Razorpay confirms the
              payment with our server. If money was debited but access was not
              activated, do not pay again. Email the order ID, payment ID,
              registered email and a screenshot or bank reference so the
              transaction can be checked.
            </p>
            <h2>2. Failed, pending or duplicate payments</h2>
            <p>
              A failed or cancelled payment does not create course access. A
              duplicate or failed-but-debited amount is reviewed against the
              gateway status and, where eligible, returned through the original
              payment method. Bank and gateway processing times apply.
            </p>
            <h2>3. Course cancellation requests</h2>
            <p>
              You may request cancellation within 48 hours of purchase if you
              have not substantially consumed the digital course, downloaded a
              material, attended a paid live class, or used a paid mock-test
              entitlement. Requests are reviewed against access and usage
              records; approval is not automatic.
            </p>
            <h2>4. When a refund may be approved</h2>
            <p>
              Refunds may be considered for verified duplicate charges, a
              successful payment where access cannot be delivered, a material
              failure to provide a published paid service, or a batch cancelled
              by JRF HUNTERS without a suitable replacement. We may offer a correction,
              extension or replacement access where that fairly resolves the
              issue.
            </p>
            <h2>5. Non-refundable use</h2>
            <p>
              Once substantial digital content has been consumed, resources
              downloaded, a live class attended, or a paid mock test used, a
              change-of-mind refund is generally not available. This does not
              limit any mandatory consumer rights that apply to your
              transaction.
            </p>
            <h2>6. How to request help</h2>
            <p>
              Contact{" "}
              <a href="mailto:mehraamit1784@gmail.com">
                mehraamit1784@gmail.com
              </a>{" "}
              with subject “Refund request – [payment ID]”. Include only the
              information needed to identify the transaction; never send card
              numbers, UPI PINs or passwords. We will acknowledge the request
              and communicate the outcome after checking the payment and course
              records.
            </p>
          </>
        )}
        {page === "grievances" && (
          <>
            <h2>Grievance contact</h2>
            <p>
              For a formal complaint about a payment, course access, content,
              privacy, account security, live class or community conduct, email{" "}
              <a href="mailto:mehraamit1784@gmail.com">
                mehraamit1784@gmail.com
              </a>{" "}
              with subject “Grievance – [short issue]”. You may also include
              your registered email, order/payment ID and relevant dates.
            </p>
            <h2>What happens next</h2>
            <ol>
              <li>
                We acknowledge a complete complaint within two business days
                where possible.
              </li>
              <li>
                We review account, enrollment, payment and service records
                relevant to the issue.
              </li>
              <li>
                We aim to provide a clear response or next action within seven
                business days, subject to third-party gateway, bank or
                service-provider investigation.
              </li>
              <li>
                If more time is needed, we explain why and provide the next
                update point.
              </li>
            </ol>
            <h2>Urgent account security</h2>
            <p>
              If you believe your account is compromised, change your password
              immediately, sign out of other sessions where available, and email
              us with “URGENT ACCOUNT SECURITY”. Never share an OTP, password,
              card number or UPI PIN with support.
            </p>
            <h2>Community conduct</h2>
            <p>
              Reports of harassment, impersonation, spam, piracy or unsafe
              behaviour in community channels can be sent to the same email.
              Please include the channel, username, date and a concise
              description. Do not publish another person’s private information
              in a complaint.
            </p>
            <h2>Escalation and applicable rights</h2>
            <p>
              If a matter cannot be resolved through support, you may use the
              consumer or other statutory forums available under applicable law.
              This page is an operational grievance process and does not remove
              any legal right or remedy.
            </p>
          </>
        )}
        {page !== "grievances" && (
          <p className="legal-contact-strip">
            <Mail size={15} /> Questions about this policy?{" "}
            <Link to="/contact">Contact the JRF Hunters support team.</Link>
          </p>
        )}
        {page === "grievances" && (
          <p className="legal-contact-strip">
            <ShieldCheck size={15} /> We keep support focused, private and
            linked to the right account or transaction.
          </p>
        )}
      </article>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand">
          <Link className="brand" to="/">
            <span className="brand-mark">
              <img
                src="/dist/assets/logo.jpeg"
                alt="JRF HUNTERS"
                style={{ width: 34, height: 34, borderRadius: 10 }}
              />
            </span>
            <span>
              <strong>JRF HUNTERS</strong>
              <small>learning studio</small>
            </span>
          </Link>
          <p>
            Focused UGC NET & JRF preparation with structured courses, live
            learning and practical revision tools.
          </p>
          <a href="mailto:mehraamit1784@gmail.com">mehraamit1784@gmail.com</a>
        </div>
        <div className="site-footer-column">
          <b>Learn</b>
          <Link to="/mock-tests">Mock tests</Link>
          <Link to="/question-bank">Question archive</Link>
          <Link to="/recorded-classes">Recorded classes</Link>
          <Link to="/study-planner">Study planner</Link>
          <Link to="/jrf-strategy">JRF strategy</Link>
        </div>
        <div className="site-footer-column">
          <b>Community</b>
          <Link to="/contact">Contact & support</Link>
          <a href="https://t.me/jrfhunters" target="_blank" rel="noreferrer">
            Telegram
          </a>
          <a
            href="https://www.instagram.com/jrfhunters/"
            target="_blank"
            rel="noreferrer"
          >
            Instagram
          </a>
          <a
            href="https://www.youtube.com/@AMITMEHRADU"
            target="_blank"
            rel="noreferrer"
          >
            YouTube
          </a>
        </div>
        <div className="site-footer-column">
          <b>Policies</b>
          <Link to="/terms">Terms & conditions</Link>
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/refunds">Refund rules</Link>
          <Link to="/grievances">Grievances</Link>
        </div>
      </div>
      <div className="site-footer-bottom">
        <span>
          © {new Date().getFullYear()} JRF HUNTERS Learning Studio · JRF Hunters
        </span>
        <span>Google Meet live · Drive replays · course media</span>
      </div>
    </footer>
  );
}

function Testimonials() {
  return (
    <div className="container">
      <div className="section-heading">
        <div>
          <span className="eyebrow">TESTIMONIALS</span>
          <h2>Success Stories from Our Students</h2>
        </div>
        <span className="muted">Real learners — concise feedback</span>
      </div>

      <div className="testimonial-row">
        {testimonials.map((t) => (
          <div className="testimonial-card" key={t.name}>
            <div className="testimonial-quote">“{t.text}”</div>
            <div className="testimonial-meta">
              {/* Use initials avatar for learners; staff photo is not used in testimonials */}
              <div className="testimonial-initials">
                {t.name
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>
              <div className="testimonial-by">
                <strong>{t.name}</strong>
                <small>{t.affiliation}</small>
                {t.status && (
                  <div className="testimonial-status">{t.status}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NameMarquee() {
  const proverb = "Learn deeply, practice consistently, perform confidently.";
  const repeats = Array(3).fill(0);
  return (
    <div className="proverb-marquee-wrap">
      <div className="proverb-marquee">
        <div className="proverb-track">
          {repeats.map((_, i) => (
            <span className="proverb-item" key={i}>
              <em>{proverb}</em>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AiLab({ user }: { user: User | null }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<{
    answer: string;
    sources: { resource_id: number; excerpt: string }[];
    mode: string;
  } | null>(null);
  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      setAnswer({
        answer:
          "Sign in first so the tutor can keep your questions with your study history.",
        sources: [],
        mode: "guest",
      });
      return;
    }
    setLoading(true);
    try {
      setAnswer(
        await api(`/rag/ask`, {
          method: "POST",
          body: JSON.stringify({ query }),
        }),
      );
    } catch (e) {
      setAnswer({ answer: (e as Error).message, sources: [], mode: "error" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="container ai-page">
      <div className="ai-header">
        <div>
          <span className="eyebrow">AI LAB · GROUNDED ANSWERS</span>
          <h1>
            Ask the material.
            <br />
            <em>Not the internet.</em>
          </h1>
          <p>
            JRF HUNTERS searches the resources you upload for each topic before
            composing an answer.
          </p>
        </div>
        <div className="ai-badge">
          <Bot size={29} />
          <span>
            <b>RAG tutor</b>
            <small>source-linked by design</small>
          </span>
        </div>
      </div>
      <div className="ai-workspace">
        <div className="prompt-card">
          <span className="eyebrow">TRY A PROMPT</span>
          <div className="suggestions">
            <button
              onClick={() =>
                setQuery(
                  "Explain formative and summative assessment with an exam example",
                )
              }
            >
              Explain a concept
            </button>
            <button
              onClick={() =>
                setQuery("Compare learner-centred and teacher-centred methods")
              }
            >
              Compare two ideas
            </button>
            <button
              onClick={() =>
                setQuery("Create a 10-question revision drill for this topic")
              }
            >
              Create a drill
            </button>
          </div>
          <form className="ask-form" onSubmit={ask}>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a detailed question about your course notes…"
              required
            />
            <button
              className="button button-lime"
              type="submit"
              disabled={loading}
            >
              {loading ? "Thinking…" : "Ask tutor"}
              <Send size={15} />
            </button>
          </form>
        </div>
        <div className="answer-card">
          {answer ? (
            <>
              <div className="answer-top">
                <span className="eyebrow">
                  {answer.mode === "llm" ? "AI SYNTHESIS" : "RETRIEVAL NOTE"}
                </span>
                <span className="source-count">
                  {answer.sources.length} sources
                </span>
              </div>
              <div className="answer-body">
                {answer.answer.split("\n").map((line, i) => (
                  <p key={i}>{line || <>&nbsp;</>}</p>
                ))}
              </div>
              {answer.sources.length > 0 && (
                <div className="source-list">
                  <span className="eyebrow">SOURCE TRAIL</span>
                  {answer.sources.map((source) => (
                    <div className="source-item" key={source.resource_id}>
                      <FileText size={15} />
                      <span>
                        <b>Resource #{source.resource_id}</b>
                        <small>{source.excerpt}…</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="answer-empty">
              <div className="answer-orb">
                <Bot size={22} />
              </div>
              <h3>Your tutor is ready.</h3>
              <p>
                Ask something specific and the indexed topic resources will
                become your revision companion.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AiLabWithImage({ user }: { user: User | null }) {
  const [query, setQuery] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<{
    answer: string;
    sources: { resource_id: number; excerpt: string }[];
    mode: string;
    retry_after?: string | null;
  } | null>(null);
  const [error, setError] = useState("");

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      setError(
        "Sign in first so the tutor can keep your questions with your study history.",
      );
      return;
    }
    if (!query.trim() && !image) {
      setError("Ask a UGC NET question or attach an image of one.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (image) {
        const form = new FormData();
        form.append("image", image);
        form.append("query", query);
        setAnswer(await api("/rag/ask-image", { method: "POST", body: form }));
      } else {
        setAnswer(
          await api("/rag/ask", {
            method: "POST",
            body: JSON.stringify({ query }),
          }),
        );
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container ai-page">
      <div className="ai-header">
        <div>
          <span className="eyebrow">AI LAB · UGC NET ONLY</span>
          <h1>
            Ask the material.
            <br />
            <em>Read the question.</em>
          </h1>
          <p>
            Groq analyzes your uploaded image directly and explains it using the
            selected course material.
          </p>
        </div>
        <div className="ai-badge">
          <Bot size={29} />
          <span>
            <b>Groq vision tutor</b>
            <small>image + text analysis</small>
          </span>
        </div>
      </div>
      <div className="ai-workspace">
        <div className="prompt-card">
          <span className="eyebrow">ASK THE PAPER 1 TUTOR</span>
          <div className="suggestions">
            <button
              type="button"
              onClick={() =>
                setQuery(
                  "Explain this UGC NET question and why the correct option is right",
                )
              }
            >
              Explain a question
            </button>
            <button
              type="button"
              onClick={() =>
                setQuery(
                  "Solve this UGC NET data interpretation question step by step",
                )
              }
            >
              Solve a graph/table
            </button>
            <button
              type="button"
              onClick={() =>
                setQuery("Give a short UGC NET revision note for this concept")
              }
            >
              Make revision notes
            </button>
          </div>
          <form className="ask-form ai-image-form" onSubmit={ask}>
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask a UGC NET Paper 1 question…"
            />
            <div className="ai-image-controls">
              <label className="image-upload-button">
                <ImagePlus size={15} />
                {image ? "Change image" : "Attach image"}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] || null;
                    if (selected && selected.size > 8 * 1024 * 1024) {
                      setError("Image must be 8 MB or smaller.");
                      return;
                    }
                    setImage(selected);
                    setError("");
                  }}
                />
              </label>
              {image && (
                <button
                  className="button-link image-name"
                  type="button"
                  onClick={() => setImage(null)}
                >
                  {image.name} · remove
                </button>
              )}
              <button
                className="button button-lime"
                type="submit"
                disabled={loading}
              >
                {loading ? "Analyzing…" : "Ask Groq"}
                <Send size={15} />
              </button>
            </div>
          </form>
          {error && <div className="form-error ai-error">{error}</div>}
          <small className="ai-scope-note">
            Scope guard: UGC NET Paper 1 topics only. Common image formats are
            sent directly; other image formats are converted to JPEG for Groq.
            Uploads are limited to 8 MB.
          </small>
        </div>
        <div className="answer-card">
          {answer ? (
            <>
              <div className="answer-top">
                <span className="eyebrow">
                  {answer.mode === "vision"
                    ? "IMAGE + TEXT ANSWER"
                    : answer.mode === "groq-limit"
                      ? "GROQ USAGE LIMIT"
                      : answer.mode === "scope-guard"
                        ? "UGC NET SCOPE"
                        : "AI SYNTHESIS"}
                </span>
                <span className="source-count">
                  {answer.sources.length} sources
                </span>
              </div>
              <div className="answer-body">
                {answer.answer.split("\n").map((line, index) => (
                  <p key={index}>{line || <>&nbsp;</>}</p>
                ))}
              </div>
              {answer.sources.length > 0 && (
                <div className="source-list">
                  <span className="eyebrow">SOURCE TRAIL</span>
                  {answer.sources.map((source) => (
                    <div
                      className="source-item"
                      key={`${source.resource_id}-${source.excerpt}`}
                    >
                      <FileText size={15} />
                      <span>
                        <b>Resource #{source.resource_id}</b>
                        <small>{source.excerpt}…</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="answer-empty">
              <div className="answer-orb">
                <Bot size={22} />
              </div>
              <h3>Your UGC NET tutor is ready.</h3>
              <p>
                Ask with text, or attach an image of a question, graph, table,
                or answer key.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type AdminPayment = {
  id: number;
  receipt_id: string;
  user_name: string;
  user_email: string;
  product: string;
  course_id?: number | null;
  amount: number;
  currency: string;
  status: string;
  order_id?: string | null;
  payment_id?: string | null;
  paid_at?: string | null;
  enrollment_status?: string | null;
  access_expires_at?: string | null;
  created_at?: string | null;
};

function BatchSalesControls({
  batchType,
  setBatchType,
  accessPeriod,
  setAccessPeriod,
  featured,
  setFeatured,
  displayOrder,
  setDisplayOrder,
}: {
  batchType: "batch" | "course" | "test_series";
  setBatchType: (value: "batch" | "course" | "test_series") => void;
  accessPeriod: "week" | "month" | "quarter" | "year" | "lifetime" | "custom";
  setAccessPeriod: (
    value: "week" | "month" | "quarter" | "year" | "lifetime" | "custom",
  ) => void;
  featured: boolean;
  setFeatured: (value: boolean) => void;
  displayOrder: string;
  setDisplayOrder: (value: string) => void;
}) {
  return (
    <section className="admin-course-list batch-sales-controls">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">BATCH SALES CONTROLS</span>
          <h2>Set how this batch is sold</h2>
        </div>
        <span className="muted">
          These controls are applied when you save the batch
        </span>
      </div>
      <div className="inline-builder">
        <label>
          Offering type
          <select
            value={batchType}
            onChange={(event) =>
              setBatchType(
                event.target.value as "batch" | "course" | "test_series",
              )
            }
          >
            <option value="batch">Live / recorded batch</option>
            <option value="course">Self-paced course</option>
            <option value="test_series">Mock test series</option>
          </select>
        </label>
        <label>
          Access period
          <select
            value={accessPeriod}
            onChange={(event) =>
              setAccessPeriod(
                event.target.value as
                  "week" | "month" | "quarter" | "year" | "lifetime" | "custom",
              )
            }
          >
            <option value="week">1 week</option>
            <option value="month">1 month</option>
            <option value="quarter">3 months</option>
            <option value="year">1 year</option>
            <option value="lifetime">Lifetime</option>
            <option value="custom">Custom days</option>
          </select>
          <small>
            {accessPeriod === "custom"
              ? "Use Access days in the course form."
              : "The access duration is calculated automatically."}
          </small>
        </label>
      </div>
      <div className="inline-builder">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={featured}
            onChange={(event) => setFeatured(event.target.checked)}
          />{" "}
          Feature this batch on the learner dashboard
        </label>
        <label>
          Catalogue order
          <input
            type="number"
            min="0"
            step="1"
            value={displayOrder}
            onChange={(event) => setDisplayOrder(event.target.value)}
          />
          <small>Lower numbers appear first.</small>
        </label>
      </div>
    </section>
  );
}

function Admin({ user }: { user: User | null }) {
  const [overview, setOverview] = useState<{
    students: number;
    courses: number;
    resources: number;
    revenue_paise: number;
  } | null>(null);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [storage, setStorage] = useState<{
    provider: string;
    all_files_folder_id?: string | null;
    courses_folder_id?: string | null;
    videos_folder_id?: string | null;
    pdfs_folder_id?: string | null;
  } | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [coursePage, setCoursePage] = useState(1);
  const [selectedModule, setSelectedModule] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [batchType, setBatchType] = useState<
    "batch" | "course" | "test_series"
  >("batch");
  const [priceRupees, setPriceRupees] = useState("2499");
  const [offerEnabled, setOfferEnabled] = useState(false);
  const [offerLabel, setOfferLabel] = useState("");
  const [offerPriceRupees, setOfferPriceRupees] = useState("");
  const [accessPeriod, setAccessPeriod] = useState<
    "week" | "month" | "quarter" | "year" | "lifetime" | "custom"
  >("year");
  const [accessDays, setAccessDays] = useState("365");
  const [launchAt, setLaunchAt] = useState("");
  const [enrollmentDeadline, setEnrollmentDeadline] = useState("");
  const [maxStudents, setMaxStudents] = useState("");
  const [featured, setFeatured] = useState(false);
  const [displayOrder, setDisplayOrder] = useState("0");
  const [courseImageFile, setCourseImageFile] = useState<File | null>(null);
  const [courseImageUrl, setCourseImageUrl] = useState<string | null>(null);
  const [mockPriceRupees, setMockPriceRupees] = useState("");
  const [freeMockAttempts, setFreeMockAttempts] = useState("");
  const [savingMockSettings, setSavingMockSettings] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [moduleName, setModuleName] = useState("");
  const [moduleTopicName, setModuleTopicName] = useState("");
  const [topicName, setTopicName] = useState("");
  type RenameTarget =
    | { kind: "course"; id: number; title: string; subject: string }
    | { kind: "module"; id: number; title: string }
    | { kind: "topic"; id: number; title: string };
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState({ title: "", subject: "" });
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [message, setMessage] = useState("");
  const [noticeVisible, setNoticeVisible] = useState(true);
  const [directorySearch, setDirectorySearch] = useState("");
  const [directoryFilter, setDirectoryFilter] = useState<"all" | "with-files">("all");
  const [directoryTypeFilter, setDirectoryTypeFilter] = useState("all");
  const [directoryResourcePages, setDirectoryResourcePages] = useState<Record<number, number>>({});
  const [directoryResourcePageSizes, setDirectoryResourcePageSizes] = useState<Record<number, number>>({});
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastAudience, setBroadcastAudience] = useState<"all" | "student" | "admin">("all");
  const [broadcastCategory, setBroadcastCategory] = useState("general");
  const [editingCourseId, setEditingCourseId] = useState<number | null>(null);
  const [versions, setVersions] = useState<
    Record<
      number,
      { version: number; original_filename: string; created_at: string }[]
    >
  >({});

  useEffect(() => {
    if (message) setNoticeVisible(true);
  }, [message]);

  useEffect(() => {
    setCoursePage(1);
  }, [subjectFilter]);

  useEffect(() => {
    setDirectoryResourcePages({});
  }, [directoryFilter, directorySearch, directoryTypeFilter, selected]);

  const normalizeCourses = (items: Course[]) => {
    const normalizeResources = (resources: Array<NonNullable<Course["modules"][number]["topics"][number]["resources"]>[number]> = []) => {
      const deduped = new Map<number, (typeof resources)[number]>();
      for (const resource of resources) {
        if (resource?.id != null) deduped.set(resource.id, resource);
      }
      return Array.from(deduped.values());
    };

    const normalizeTopics = (topics: Course["modules"][number]["topics"] = []) => {
      const deduped = new Map<number, (typeof topics)[number]>();
      for (const topic of topics) {
        const existing = deduped.get(topic.id);
        if (!existing) {
          deduped.set(topic.id, {
            ...topic,
            resources: normalizeResources(topic.resources),
          });
          continue;
        }

        deduped.set(topic.id, {
          ...existing,
          ...topic,
          resources: normalizeResources([
            ...(existing.resources || []),
            ...(topic.resources || []),
          ]),
        });
      }
      return Array.from(deduped.values());
    };

    const normalizeModules = (modules: Course["modules"] = []) => {
      const deduped = new Map<number, (typeof modules)[number]>();
      for (const module of modules) {
        const existing = deduped.get(module.id);
        if (!existing) {
          deduped.set(module.id, {
            ...module,
            topics: normalizeTopics(module.topics),
          });
          continue;
        }

        deduped.set(module.id, {
          ...existing,
          ...module,
          topics: normalizeTopics([
            ...(existing.topics || []),
            ...(module.topics || []),
          ]),
        });
      }
      return Array.from(deduped.values()).sort(
        (left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0),
      );
    };

    return items.map((course) => ({
      ...course,
      modules: normalizeModules(course.modules),
    }));
  };

  const refresh = async () => {
    const [stats, items, storageInfo, paymentItems] = await Promise.all([
      api<typeof overview>("/admin/overview"),
      api<Course[]>("/admin/courses"),
      api<typeof storage>("/admin/storage"),
      api<AdminPayment[]>("/admin/payments"),
    ]);
    const normalizedItems = normalizeCourses(items);
    setOverview(stats);
    setCourses(normalizedItems);
    setStorage(storageInfo);
    setPayments(paymentItems);
    setSelected((id) =>
      id && normalizedItems.some((item) => String(item.id) === id)
        ? id
        : String(normalizedItems[0]?.id || ""),
    );
  };

  useEffect(() => {
    if (user?.role !== "admin") return;
    const poll = () =>
      refresh().catch((cause) => setMessage((cause as Error).message));
    void poll();
    const timer = window.setInterval(poll, 15000);
    return () => window.clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    void api<{ price_paise: number; free_attempt_limit: number }>("/admin/settings/mock-test")
      .then((configuration) => {
        setMockPriceRupees((configuration.price_paise / 100).toString());
        setFreeMockAttempts(String(configuration.free_attempt_limit));
      })
      .catch(() => undefined);
  }, [user?.id]);

  const current = courses.find((course) => course.id === Number(selected));
  const subjects = Array.from(
    new Set(courses.map((course) => course.subject).filter(Boolean)),
  ).sort();
  const filteredCourses = subjectFilter
    ? courses.filter((course) => course.subject === subjectFilter)
    : courses;
  const coursePageSize = 6;
  const courseTotalPages = Math.max(1, Math.ceil(courses.length / coursePageSize));
  const safeCoursePage = Math.min(coursePage, courseTotalPages);
  const paginatedCourses = courses.slice(
    (safeCoursePage - 1) * coursePageSize,
    safeCoursePage * coursePageSize,
  );
  const coursePageNumbers = Array.from({ length: courseTotalPages }, (_, index) => index + 1);
  const modules = current?.modules || [];
  const currentModule = modules.find(
    (module) => module.id === Number(selectedModule),
  );
  const topics = currentModule?.topics || [];
  const groupedModules = useMemo(() => {
    const moduleMap = new Map<number, typeof modules[number]>();
    for (const module of modules) {
      const existing = moduleMap.get(module.id);
      if (!existing) {
        moduleMap.set(module.id, {
          ...module,
          topics: Array.from(
            new Map<number, typeof module.topics[number]>(
              (module.topics || []).map((topic) => [topic.id, {
                ...topic,
                resources: Array.from(
                  new Map<number, (typeof topic.resources)[number]>(
                    (topic.resources || []).map((resource) => [resource.id, resource]),
                  ).values(),
                ),
              }]),
            ).values(),
          ),
        });
        continue;
      }

      const mergedTopicMap = new Map<number, typeof module.topics[number]>();
      for (const topic of existing.topics || []) {
        mergedTopicMap.set(topic.id, {
          ...topic,
          resources: Array.from(
            new Map<number, (typeof topic.resources)[number]>(
              (topic.resources || []).map((resource) => [resource.id, resource]),
            ).values(),
          ),
        });
      }
      for (const topic of module.topics || []) {
        const current = mergedTopicMap.get(topic.id);
        const mergedResources = new Map<number, (typeof topic.resources)[number]>();
        for (const resource of current?.resources || []) mergedResources.set(resource.id, resource);
        for (const resource of topic.resources || []) mergedResources.set(resource.id, resource);
        mergedTopicMap.set(topic.id, {
          ...(current || topic),
          ...topic,
          resources: Array.from(mergedResources.values()),
        });
      }

      moduleMap.set(module.id, {
        ...existing,
        ...module,
        topics: Array.from(mergedTopicMap.values()),
      });
    }

    return Array.from(moduleMap.values()).sort(
      (left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0),
    );
  }, [modules]);
  const filteredGroupedModules = useMemo(() => {
    const query = directorySearch.trim().toLowerCase();
    return groupedModules.flatMap((module) => {
      const moduleMatches = module.title.toLowerCase().includes(query);
      const topics = (module.topics || []).flatMap((topic) => {
        const topicMatches = topic.title.toLowerCase().includes(query);
        const resources = (topic.resources || []).filter((resource) => {
          const typeMatches = directoryTypeFilter === "all" || resource.resource_type === directoryTypeFilter;
          const textMatches = !query || moduleMatches || topicMatches || `${resource.title} ${resource.original_filename}`.toLowerCase().includes(query);
          return typeMatches && textMatches;
        });
        return query && !moduleMatches && !topicMatches && resources.length === 0
          ? []
          : [{ ...topic, resources }];
      });
      const fileCount = topics.reduce((count, topic) => count + topic.resources.length, 0);
      if (directoryFilter === "with-files" && fileCount === 0) return [];
      if (query && !moduleMatches && topics.length === 0) return [];
      if (directoryTypeFilter !== "all" && fileCount === 0) return [];
      return [{ ...module, topics }];
    });
  }, [directoryFilter, directorySearch, directoryTypeFilter, groupedModules]);
  const allTopics = courses.flatMap((course) =>
    course.modules.flatMap((module) =>
      module.topics.map((topic) => ({
        ...topic,
        moduleTitle: module.title,
        courseTitle: course.title,
      })),
    ),
  );
  const materials =
    current?.modules.flatMap((module) =>
      module.topics.flatMap((topic) =>
        topic.resources.map((resource) => ({
          ...resource,
          topic: topic.title,
          module: module.title,
          topicId: topic.id,
        })),
      ),
    ) || [];

  useEffect(() => {
    const nextModule =
      modules.find((module) => String(module.id) === selectedModule) ||
      modules[0];
    setSelectedModule(String(nextModule?.id || ""));
  }, [selected, courses]);

  useEffect(() => {
    const nextTopic =
      topics.find((topic) => String(topic.id) === selectedTopic) || topics[0];
    setSelectedTopic(String(nextTopic?.id || ""));
  }, [selectedModule, selected, courses]);

  const selectCourse = (value: string) => {
    const next = courses.find((course) => String(course.id) === value);
    setSelected(value);
    if (next) setSubjectFilter(next.subject);
  };

  const resetCourseForm = () => {
    setEditingCourseId(null);
    setCourseImageFile(null);
    setCourseImageUrl(null);
    setName("");
    setSlug("");
    setSubject("");
    setDescription("");
    setBatchType("batch");
    setPriceRupees("2499");
    setOfferEnabled(false);
    setOfferLabel("");
    setOfferPriceRupees("");
    setAccessPeriod("year");
    setAccessDays("365");
    setLaunchAt("");
    setEnrollmentDeadline("");
    setMaxStudents("");
    setFeatured(false);
    setDisplayOrder("0");
  };

  const localDateTimeValue = (value?: string | null) =>
    value ? new Date(value).toISOString().slice(0, 16) : "";
  const dateTimePayload = (value: string) =>
    value ? new Date(value).toISOString() : null;

  const saveCourse = async (event: FormEvent) => {
    event.preventDefault();
    const nextSlug = (slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    try {
      const parsedPrice = Number(priceRupees);
      const parsedDays = Number(accessDays);
      const standardDays: Record<string, number> = {
        week: 7,
        month: 30,
        quarter: 90,
        year: 365,
        lifetime: 0,
      };
      const finalDays =
        accessPeriod === "custom" ? parsedDays : standardDays[accessPeriod];
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0)
        throw new Error("Enter a valid price in INR.");
      const parsedOfferPrice = offerPriceRupees ? Number(offerPriceRupees) : null;
      if (offerEnabled && (!offerLabel.trim() || parsedOfferPrice === null || !Number.isFinite(parsedOfferPrice) || parsedOfferPrice <= 0 || parsedOfferPrice >= parsedPrice))
        throw new Error("Offer requires a label and a price lower than the regular price.");
      if (
        !Number.isInteger(finalDays) ||
        finalDays < 0 ||
        (accessPeriod === "custom" && finalDays === 0)
      )
        throw new Error(
          "Custom access must be a positive whole number of days.",
        );
      const body = JSON.stringify({
        title: name.trim(),
        slug: nextSlug,
        subject: subject.trim(),
        description: description.trim(),
        batch_type: batchType,
        access_period: accessPeriod,
        price_paise: Math.round(parsedPrice * 100),
        offer_enabled: offerEnabled,
        offer_label: offerEnabled ? offerLabel.trim() : null,
        offer_price_paise: offerEnabled && parsedOfferPrice !== null ? Math.round(parsedOfferPrice * 100) : null,
        access_duration_days: finalDays,
        launch_at: dateTimePayload(launchAt),
        enrollment_deadline: dateTimePayload(enrollmentDeadline),
        max_students: maxStudents ? Number(maxStudents) : null,
        is_featured: featured,
        display_order: Number(displayOrder) || 0,
      });
      let savedCourseId = editingCourseId;
      if (editingCourseId) {
        await api(`/courses/${editingCourseId}`, { method: "PATCH", body });
      } else {
        const created = await api<Course>("/courses", { method: "POST", body });
        savedCourseId = created.id;
        setSelected(String(created.id));
        if (courseImageFile) setEditingCourseId(created.id);
      }
      if (courseImageFile && savedCourseId) {
        const imageForm = new FormData();
        imageForm.append("file", courseImageFile);
        await api(`/courses/${savedCourseId}/image`, { method: "POST", body: imageForm });
      }
      resetCourseForm();
      await refresh();
      setMessage(editingCourseId ? "Course updated." : "Course created.");
      adminSuccess(
        editingCourseId ? "Course updated" : "Course created",
        editingCourseId ? "Course changes were saved successfully." : "The new course is ready in the catalogue.",
      );
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("Course save failed", cause, "Unable to save course changes.");
    }
  };

  const saveMockSettings = async (event: FormEvent) => {
    event.preventDefault();
    const parsedPrice = Number(mockPriceRupees);
    const parsedAttempts = Number(freeMockAttempts);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1)
      return setMessage("Enter a mock-test price of at least ₹1.");
    if (!Number.isInteger(parsedAttempts) || parsedAttempts < 0 || parsedAttempts > 100)
      return setMessage("Free attempts must be a whole number from 0 to 100.");
    setSavingMockSettings(true);
    try {
      const configuration = await api<{ price_paise: number; free_attempt_limit: number }>(
        "/admin/settings/mock-test",
        {
          method: "PATCH",
          body: JSON.stringify({
            price_paise: Math.round(parsedPrice * 100),
            free_attempt_limit: parsedAttempts,
          }),
        },
      );
      setMockPriceRupees((configuration.price_paise / 100).toString());
      setFreeMockAttempts(String(configuration.free_attempt_limit));
      setMessage("Mock-test access settings saved.");
      adminSuccess("Settings saved", "Mock-test price and free-attempt limit were updated.");
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("Settings save failed", cause, "Unable to save mock-test settings.");
    } finally {
      setSavingMockSettings(false);
    }
  };

  const sendBroadcast = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/notifications/broadcast", {
        method: "POST",
        body: JSON.stringify({
          title: broadcastTitle.trim(),
          message: broadcastMessage.trim(),
          category: broadcastCategory.trim() || "general",
          audience: broadcastAudience,
        }),
      });
      setMessage("Broadcast sent to the selected audience.");
      setBroadcastTitle("");
      setBroadcastMessage("");
      setBroadcastCategory("general");
      setBroadcastAudience("all");
      adminSuccess("Broadcast sent", "The announcement was sent to the selected audience.");
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("Broadcast failed", cause, "Unable to send the announcement.");
    }
  };

  const editCourse = (course: Course) => {
    setEditingCourseId(course.id);
    setCourseImageFile(null);
    setCourseImageUrl(course.cover_image_url || null);
    setSelected(String(course.id));
    setName(course.title);
    setSlug(course.slug);
    setSubject(course.subject);
    setDescription(course.description);
    setBatchType(course.batch_type || "batch");
    setPriceRupees((course.price_paise / 100).toString());
    setOfferEnabled(Boolean(course.offer_enabled));
    setOfferLabel(course.offer_label || "");
    setOfferPriceRupees(course.offer_price_paise ? (course.offer_price_paise / 100).toString() : "");
    setAccessPeriod(
      course.access_period ||
        (course.access_duration_days === 0 ? "lifetime" : "custom"),
    );
    setAccessDays(String(course.access_duration_days));
    setLaunchAt(localDateTimeValue(course.launch_at));
    setEnrollmentDeadline(localDateTimeValue(course.enrollment_deadline));
    setMaxStudents(course.max_students ? String(course.max_students) : "");
    setFeatured(Boolean(course.is_featured));
    setDisplayOrder(String(course.display_order || 0));
  };
  const notifications = useNotifications();
  const adminSuccess = (title: string, message: string) =>
    notifications.showToast({ kind: "success", title, message });
  const adminError = (title: string, cause: unknown, fallback: string) =>
    notifications.showToast({
      kind: "error",
      title,
      message: (cause as Error).message || fallback,
    });

  const deleteCourse = async (course: Course) => {
    const confirmed = await notifications.confirmAction({
      title: "Delete course",
      message: `Delete “${course.title}” and its complete directory? This action cannot be undone.`,
      confirmLabel: "Delete course",
      destructive: true,
      onConfirm: async () => {
        await api(`/courses/${course.id}`, { method: "DELETE" });
        await refresh();
        setMessage("Course and its directory were deleted.");
        notifications.showToast({
          kind: "success",
          title: "Course deleted",
          message: `${course.title} was removed successfully.`,
        });
      },
    });
    if (!confirmed) {
      notifications.showToast({ kind: "info", title: "Deletion cancelled", message: "The course was not deleted." });
      return;
    }
  };
  const togglePublish = async (course: Course) => {
    try {
      await api(`/courses/admin/${course.id}/publish`, { method: "POST" });
      await refresh();
      setMessage(
        course.is_published
          ? "Course hidden from learners."
          : "Course published to learners.",
      );
      adminSuccess(
        course.is_published ? "Course unpublished" : "Course published",
        course.is_published ? "The course is hidden from learners." : "The course is now visible to learners.",
      );
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("Course visibility failed", cause, "Unable to update course visibility.");
    }
  };

  const togglePinCourse = async (course: Course) => {
    try {
      await api(`/courses/${course.id}/pin`, { method: "PATCH" });
      await refresh();
      setMessage(
        course.is_pinned
          ? "This course is already pinned to Home."
          : "Pinned to the Home page.",
      );
      adminSuccess("Home pin updated", course.is_pinned ? "The course was unpinned from Home." : "The course is now pinned to Home.");
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("Home pin update failed", cause, "Unable to update the Home pin.");
    }
  };

  const createModule = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !moduleName.trim()) return;
    try {
      const created = await api<{ id: number }>(
        `/courses/${selected}/modules`,
        {
          method: "POST",
          body: JSON.stringify({
            title: moduleName.trim(),
            sort_order: modules.length + 1,
            topic_title: moduleTopicName.trim() || null,
          }),
        },
      );
      setModuleName("");
      setModuleTopicName("");
      await refresh();
      setSelectedModule(String(created.id));
      setMessage(
        moduleTopicName.trim()
          ? "Module and first topic created."
          : "Empty module created. Add topics whenever you are ready.",
      );
      adminSuccess("Module created", moduleTopicName.trim() ? "Module and first topic created." : "The empty module is ready for topics.");
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("Module creation failed", cause, "Unable to create the module.");
    }
  };
  const createTopic = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedModule || !topicName.trim()) return;
    const topicSlug = topicName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    try {
      const created = await api<{ id: number }>(
        `/courses/modules/${selectedModule}/topics`,
        {
          method: "POST",
          body: JSON.stringify({
            title: topicName.trim(),
            slug: topicSlug,
            summary: "",
            sort_order: topics.length + 1,
          }),
        },
      );
      setTopicName("");
      await refresh();
      setSelectedTopic(String(created.id));
      setMessage("Topic created.");
      adminSuccess("Topic created", "The topic is ready for learning material.");
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("Topic creation failed", cause, "Unable to create the topic.");
    }
  };
  const openRenameTarget = (target: RenameTarget) => {
    setRenameTarget(target);
    setRenameDraft({
      title: target.title,
      subject: target.kind === "course" ? target.subject : "",
    });
    setRenameError("");
  };

  const closeRenameTarget = () => {
    setRenameTarget(null);
    setRenameDraft({ title: "", subject: "" });
    setRenameError("");
    setRenameBusy(false);
  };

  const saveRenameTarget = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameTarget) return;

    const titleValue = renameDraft.title.trim();
    if (!titleValue || titleValue.length < 2) {
      setRenameError("Name must be at least 2 characters long.");
      return;
    }

    if (renameTarget.kind === "course") {
      const subjectValue = renameDraft.subject.trim();
      if (!subjectValue || subjectValue.length < 2) {
        setRenameError("Subject must be at least 2 characters long.");
        return;
      }
    }

    try {
      setRenameBusy(true);
      setRenameError("");

      if (renameTarget.kind === "course") {
        await api(`/courses/${renameTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: titleValue,
            subject: renameDraft.subject.trim(),
          }),
        });
        setMessage("Course renamed.");
      }

      if (renameTarget.kind === "module") {
        await api(`/courses/modules/${renameTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: titleValue }),
        });
        setMessage("Module renamed.");
      }

      if (renameTarget.kind === "topic") {
        await api(`/courses/topics/${renameTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: titleValue,
            slug: titleValue
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, ""),
          }),
        });
        setMessage("Topic renamed.");
      }

      await refresh();
      adminSuccess(
        `${renameTarget.kind === "course" ? "Course" : renameTarget.kind === "module" ? "Module" : "Topic"} renamed`,
        "The new name was saved successfully.",
      );
      closeRenameTarget();
    } catch (cause) {
      setRenameError((cause as Error).message || "Could not update the selected item.");
      adminError("Rename failed", cause, "Unable to save the new name.");
    } finally {
      setRenameBusy(false);
    }
  };
  const deleteModule = async (moduleId: number) => {
    const confirmed = await notifications.confirmAction({
      title: "Delete module",
      message: "Delete this module, its topics, and all files inside it?",
      confirmLabel: "Delete module",
      destructive: true,
      onConfirm: async () => {
        await api(`/courses/modules/${moduleId}`, { method: "DELETE" });
        await refresh();
        setMessage("Module deleted.");
        notifications.showToast({
          kind: "success",
          title: "Module deleted",
          message: "The selected module and its contents were removed.",
        });
      },
    });
    if (!confirmed) {
      notifications.showToast({ kind: "info", title: "Deletion cancelled", message: "The module was not deleted." });
      return;
    }
  };
  const deleteTopic = async (topicId: number) => {
    const confirmed = await notifications.confirmAction({
      title: "Delete topic",
      message: "Delete this topic and its files? This cannot be undone.",
      confirmLabel: "Delete topic",
      destructive: true,
      onConfirm: async () => {
        await api(`/courses/topics/${topicId}`, { method: "DELETE" });
        await refresh();
        setMessage("Topic deleted.");
        notifications.showToast({
          kind: "success",
          title: "Topic deleted",
          message: "The selected topic and files were removed.",
        });
      },
    });
    if (!confirmed) {
      notifications.showToast({ kind: "info", title: "Deletion cancelled", message: "The topic was not deleted." });
      return;
    }
  };

  const addMaterial = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || files.length === 0) return;
    try {
      let targetTopic = selectedTopic;
      let createdFallbackTopic = false;
      if (!targetTopic && selectedModule && topics.length === 0) {
        const created = await api<{ id: number }>(
          `/courses/modules/${selectedModule}/topics`,
          {
            method: "POST",
            body: JSON.stringify({
              title: "General resources",
              slug: "general-resources",
              summary: "Files uploaded directly to this module.",
              sort_order: 1,
            }),
          },
        );
        targetTopic = String(created.id);
        createdFallbackTopic = true;
      }
      if (!targetTopic) {
        setMessage("Choose a topic before uploading these files.");
        return;
      }
      const form = new FormData();
      for (const fileToUpload of files) {
        form.append("file", fileToUpload);
      }
      await api(`/courses/topics/${targetTopic}/resources`, {
        method: "POST",
        body: form,
      });
      setFiles([]);
      setFileInputKey((key) => key + 1);
      await refresh();
      setMessage(
        createdFallbackTopic
          ? `General resources topic created and ${files.length} file${files.length === 1 ? "" : "s"} uploaded.`
          : `${files.length} file${files.length === 1 ? "" : "s"} uploaded to the selected directory.`,
      );
      adminSuccess("Material uploaded", `${files.length} file${files.length === 1 ? " was" : "s were"} uploaded successfully.`);
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("Upload failed", cause, "Unable to upload the selected material.");
    }
  };
  const replace = async (
    id: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const replacement = event.target.files?.[0];
    if (!replacement) return;
    const form = new FormData();
    form.append("file", replacement);
    try {
      await api(`/courses/resources/${id}`, { method: "PUT", body: form });
      await refresh();
      setMessage("File replaced and its history was saved.");
      adminSuccess("File replaced", "The new file was uploaded and its history was saved.");
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("File replacement failed", cause, "Unable to replace the file.");
    }
  };
  const renameResource = async (id: number, title: string) => {
    const next = window.prompt("File title", title)?.trim();
    if (!next || next === title) return;
    try {
      await api(`/courses/resources/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: next }),
      });
      await refresh();
      setMessage("File title updated.");
      adminSuccess("File renamed", "The file title was updated successfully.");
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("File rename failed", cause, "Unable to update the file title.");
    }
  };
  const moveResource = async (id: number, topicId: string) => {
    if (!topicId) return;
    try {
      await api(`/courses/resources/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ topic_id: Number(topicId) }),
      });
      await refresh();
      setMessage("File moved to the selected directory.");
      adminSuccess("File moved", "The file is now in the selected directory.");
    } catch (cause) {
      setMessage((cause as Error).message);
      adminError("File move failed", cause, "Unable to move the file.");
    }
  };
  const deleteResource = async (id: number) => {
    const confirmed = await notifications.confirmAction({
      title: "Delete file",
      message: "Delete this file permanently?",
      confirmLabel: "Delete file",
      destructive: true,
      onConfirm: async () => {
        try {
          await api(`/courses/resources/${id}`, { method: "DELETE" });
          await refresh();
          setMessage("File deleted.");
          notifications.showToast({
            kind: "success",
            title: "File deleted",
            message: "The selected learning resource was permanently removed.",
          });
        } catch (cause) {
          const message = (cause as Error).message || "Unable to delete the file from storage.";
          setMessage(message);
          notifications.showToast({
            kind: "error",
            title: "File deletion failed",
            message,
          });
          throw cause;
        }
      },
    });
    if (!confirmed) {
      notifications.showToast({ kind: "info", title: "Deletion cancelled", message: "The file was not deleted." });
      return;
    }
  };
  const showVersions = async (id: number) => {
    try {
      const entries = await api<
        { version: number; original_filename: string; created_at: string }[]
      >(`/courses/resources/${id}/revisions`);
      setVersions((currentVersions) => ({ ...currentVersions, [id]: entries }));
    } catch (cause) {
      setMessage((cause as Error).message);
    }
  };

  if (!user || user.role !== "admin")
    return (
      <div className="container">
        <div className="empty-state">
          <ShieldCheck size={26} />
          <h2>Admin access only.</h2>
          <p>Only administrators can manage courses and files.</p>
        </div>
      </div>
    );
  const metricCards = [
    { label: "Students", value: overview?.students ?? "—", icon: "👥" },
    { label: "Materials", value: overview?.resources ?? "—", icon: "🗂️" },
    {
      label: "Revenue",
      value: overview ? `₹${(overview.revenue_paise / 100).toLocaleString("en-IN")}` : "—",
      icon: "💰",
    },
  ];

  return (
    <div className="container admin-page">
      <div className="admin-head">
        <div className="admin-head-copy">
          <span className="eyebrow">ADMIN CONTENT</span>
          <h1>Courses and materials.</h1>
          <p>
            Manage courses, modules, topics and learning resources from one
            workspace.
          </p>
        </div>
        <span className="admin-badge">
          <ShieldCheck size={17} />
          admin only
        </span>
      </div>

      <section className="admin-hero">
        <div className="admin-hero-copy">
          <span className="eyebrow">ADMIN OVERVIEW</span>
          <h2>Workspace control</h2>
          <p>
            Build and manage a visible directory, upload any file type, and keep
            every learning asset organized from one place.
          </p>
        </div>
        <div className="admin-metric-grid">
          {metricCards.map((metric) => (
            <div className="admin-metric-card" key={metric.label}>
              <span className="admin-metric-icon">{metric.icon}</span>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>
      </section>

      {message && noticeVisible && (
        <div className="admin-inline-alert" role="status" aria-live="polite">
          <span className="admin-inline-alert-text">⚠ {message}</span>
          <button
            type="button"
            className="admin-inline-alert-close"
            onClick={() => setNoticeVisible(false)}
            aria-label="Dismiss alert"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <section className="broadcast-panel">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">SYSTEM ALERTS</span>
            <h2>Send an announcement</h2>
          </div>
        </div>
        <form className="broadcast-form" onSubmit={sendBroadcast}>
          <label>
            Title
            <input value={broadcastTitle} onChange={(event) => setBroadcastTitle(event.target.value)} required placeholder="Batch reminder" />
          </label>
          <label>
            Message
            <textarea value={broadcastMessage} onChange={(event) => setBroadcastMessage(event.target.value)} required rows={4} placeholder="Share a schedule update, reminder, or platform notice for learners." />
          </label>
          <div className="inline-builder">
            <label>
              Audience
              <select value={broadcastAudience} onChange={(event) => setBroadcastAudience(event.target.value as "all" | "student" | "admin")}>
                <option value="all">Everyone</option>
                <option value="student">Students only</option>
                <option value="admin">Admins only</option>
              </select>
            </label>
            <label>
              Category
              <input value={broadcastCategory} onChange={(event) => setBroadcastCategory(event.target.value)} placeholder="general" />
            </label>
          </div>
          <button className="button button-dark" type="submit">Send notification</button>
        </form>
      </section>
      {storage?.all_files_folder_id && (
        <div className="storage-config-note">
          <b>Google Drive all-files folder</b>
          <code>{storage.all_files_folder_id}</code>
          <small>
            Verified JSON exports and uploaded resources can be read from this
            configured folder. Learners only receive protected Open/Download
            links.
          </small>
        </div>
      )}
      <div className="admin-quicklink-row">
        <Link to="/admin/payments" className="admin-quicklink-card">
          <span className="admin-quicklink-icon">
            <CheckCircle2 size={18} />
          </span>
          <span>
            <b>Payments &amp; receipts</b>
            <small>
              {payments.length} recent transactions · view the full ledger
            </small>
          </span>
          <ArrowRight size={15} />
        </Link>
      </div>
      {renameTarget && (
        <div className="rename-modal-backdrop" onClick={closeRenameTarget}>
          <div className="rename-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">RENAME</span>
                <h2>
                  {renameTarget.kind === "course"
                    ? "Course details"
                    : renameTarget.kind === "module"
                      ? "Module name"
                      : "Topic name"}
                </h2>
              </div>
            </div>
            <form className="rename-form" onSubmit={saveRenameTarget}>
              <label>
                {renameTarget.kind === "course" ? "Course name" : "Name"}
                <input
                  value={renameDraft.title}
                  onChange={(event) =>
                    setRenameDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Enter a new name"
                  autoFocus
                  required
                />
              </label>

              {renameTarget.kind === "course" && (
                <label>
                  Subject
                  <input
                    value={renameDraft.subject}
                    onChange={(event) =>
                      setRenameDraft((current) => ({ ...current, subject: event.target.value }))
                    }
                    placeholder="Enter subject"
                    required
                  />
                </label>
              )}

              {renameError && (
                <div className="admin-inline-alert" role="alert">
                  <span className="admin-inline-alert-text">⚠ {renameError}</span>
                </div>
              )}

              <div className="form-action-row">
                <button type="button" className="button button-small" onClick={closeRenameTarget}>
                  Cancel
                </button>
                <button type="submit" className="button button-dark" disabled={renameBusy}>
                  {renameBusy ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="panel admin-mock-settings">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">MOCK TEST ACCESS</span>
            <h2>Price and free attempts</h2>
          </div>
        </div>
        <form className="admin-mock-settings-form" onSubmit={saveMockSettings}>
          <div className="inline-builder">
            <label>
              Unlimited access price (INR)
              <input
                type="number"
                min="1"
                step="0.01"
                value={mockPriceRupees}
                onChange={(event) => setMockPriceRupees(event.target.value)}
                required
              />
            </label>
            <label>
              Free attempts per user
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={freeMockAttempts}
                onChange={(event) => setFreeMockAttempts(event.target.value)}
                required
              />
            </label>
          </div>
          <div className="form-action-row">
            <button className="button button-dark" type="submit" disabled={savingMockSettings}>
              <Save size={14} /> {savingMockSettings ? "Saving..." : "Save settings"}
            </button>
          </div>
        </form>
      </section>
      <section className="admin-course-list">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">BATCH CATALOGUE</span>
            <h2>Create and sell learning batches</h2>
          </div>
          <span className="muted">
            Only published batches appear in the learner dashboard
          </span>
        </div>
        {paginatedCourses.map((course) => (
          <div className="admin-course-row" key={course.id}>
            <div>
              <div className="admin-course-row-title">
                <FolderOpen size={16} />
                <b>{course.title}</b>
                {course.is_featured && (
                  <span className="published-pill">Featured</span>
                )}
                <span
                  className={
                    course.is_published ? "published-pill" : "draft-pill"
                  }
                >
                  {course.is_published ? "Published" : "Draft"}
                </span>
              </div>
              <small>
                {course.batch_type === "test_series"
                  ? "Test series"
                  : course.batch_type === "course"
                    ? "Course"
                    : "Batch"}{" "}
                · {course.subject} · ₹
                {(course.price_paise / 100).toLocaleString("en-IN")} ·{" "}
                {accessPeriodLabel(course)} · {course.modules.length} modules ·{" "}
                {course.modules.reduce(
                  (count, module) =>
                    count +
                    module.topics.reduce(
                      (topicCount, topic) =>
                        topicCount + topic.resources.length,
                      0,
                    ),
                  0,
                )}{" "}
                files
                {course.max_students ? ` · ${course.max_students} seats` : ""}
              </small>
              {course.launch_at && (
                <small>
                  Launch: {new Date(course.launch_at).toLocaleString("en-IN")}
                  {course.enrollment_deadline
                    ? ` · Enrollment closes: ${new Date(course.enrollment_deadline).toLocaleString("en-IN")}`
                    : ""}
                </small>
              )}
            </div>
            <div className="admin-course-actions">
              <button
                className="button button-small"
                onClick={() => openRenameTarget({ kind: "course", id: course.id, title: course.title, subject: course.subject })}
              >
                <Pencil size={13} /> Rename
              </button>
              <button
                className="button button-small"
                onClick={() => editCourse(course)}
              >
                <Pencil size={13} /> Edit
              </button>
              <button
                className={course.is_pinned ? "button button-small button-lime" : "button button-small"}
                onClick={() => void togglePinCourse(course)}
              >
                {course.is_pinned ? "✓ Pinned to Home" : "Pin to Home"}
              </button>
              <button
                className="button button-small button-lime"
                onClick={() => void togglePublish(course)}
              >
                {course.is_published ? "Unpublish" : "Publish"}
              </button>
              <button
                className="button button-small button-danger"
                onClick={() => void deleteCourse(course)}
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        ))}
        {courseTotalPages > 1 && (
          <div className="pagination-row" aria-label="Admin course pagination">
            <button
              type="button"
              className="button button-small button-outline"
              disabled={safeCoursePage === 1}
              onClick={() => setCoursePage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <div className="pagination-pages" aria-live="polite">
              {coursePageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  className={`button button-small ${safeCoursePage === pageNumber ? "button-dark" : "button-outline"}`}
                  onClick={() => setCoursePage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="button button-small button-outline"
              disabled={safeCoursePage === courseTotalPages}
              onClick={() => setCoursePage((current) => Math.min(courseTotalPages, current + 1))}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        )}
      </section>
      <BatchSalesControls
        batchType={batchType}
        setBatchType={setBatchType}
        accessPeriod={accessPeriod}
        setAccessPeriod={setAccessPeriod}
        featured={featured}
        setFeatured={setFeatured}
        displayOrder={displayOrder}
        setDisplayOrder={setDisplayOrder}
      />
      <div className="material-manager">
        <form className="material-form" onSubmit={saveCourse}>
          <span className="eyebrow">
            {editingCourseId ? "EDIT COURSE" : "NEW COURSE"}
          </span>
          <label>
            Course name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            Subject
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
            />
          </label>
          <label>
            URL slug
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="teaching-aptitude"
              required
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {courseImageUrl && (
            <img className="admin-course-image-preview" src={courseImageUrl} alt="Current course cover" />
          )}
          <label>
            Course image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setCourseImageFile(event.target.files?.[0] || null)}
            />
            <small>JPEG, PNG, or WebP · maximum 5 MB</small>
            {courseImageFile && <small>Selected: {courseImageFile.name}</small>}
          </label>
          <div className="inline-builder">
            <label>
              Price (INR)
              <input
                type="number"
                min="0"
                step="0.01"
                value={priceRupees}
                onChange={(event) => setPriceRupees(event.target.value)}
                required
              />
            </label>
            <label>
              Access days
              <input
                type="number"
                min="0"
                step="1"
                value={accessDays}
                onChange={(event) => setAccessDays(event.target.value)}
                required
              />
              <small>0 = lifetime</small>
            </label>
          </div>
          <fieldset className="offer-editor">
            <legend>Optional offer</legend>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={offerEnabled}
                onChange={(event) => setOfferEnabled(event.target.checked)}
              />
              Enable offer pricing
            </label>
            {offerEnabled && (
              <div className="inline-builder">
                <label>
                  Offer label
                  <input
                    value={offerLabel}
                    onChange={(event) => setOfferLabel(event.target.value)}
                    placeholder="🔥 Launch Offer"
                    maxLength={160}
                  />
                </label>
                <label>
                  Offer price (INR)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={offerPriceRupees}
                    onChange={(event) => setOfferPriceRupees(event.target.value)}
                    placeholder="1999"
                  />
                </label>
              </div>
            )}
          </fieldset>
          <div className="inline-builder">
            <label>
              Launch date/time
              <input
                type="datetime-local"
                value={launchAt}
                onChange={(event) => setLaunchAt(event.target.value)}
              />
              <small>Blank = available after publish</small>
            </label>
            <label>
              Enrollment closes
              <input
                type="datetime-local"
                value={enrollmentDeadline}
                onChange={(event) => setEnrollmentDeadline(event.target.value)}
              />
            </label>
          </div>
          <label>
            Maximum students (optional)
            <input
              type="number"
              min="1"
              step="1"
              value={maxStudents}
              onChange={(event) => setMaxStudents(event.target.value)}
              placeholder="Unlimited"
            />
          </label>
          <div className="form-action-row">
            <button className="button button-dark" type="submit">
              <Save size={14} />{" "}
              {editingCourseId ? "Save course" : "Create course"}
            </button>
            {editingCourseId && (
              <button
                className="button button-small"
                type="button"
                onClick={resetCourseForm}
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="material-form upload-panel-shell" id="admin-upload-panel">
          <div className="upload-panel-header">
            <span className="eyebrow">UPLOAD MATERIAL</span>
            <h3>Existing subject → course → module → topic</h3>
          </div>

          <div className="upload-stepper" aria-label="Upload flow">
            <div className={`upload-step ${subjectFilter ? "done" : "active"}`}>
              <span>01</span>
              <small>Subject</small>
            </div>
            <div className={`upload-step ${selected ? "done" : "active"}`}>
              <span>02</span>
              <small>Course</small>
            </div>
            <div className={`upload-step ${selectedModule ? "done" : "active"}`}>
              <span>03</span>
              <small>Module</small>
            </div>
            <div className={`upload-step ${selectedTopic || (!selectedModule && selected) ? "done" : "active"}`}>
              <span>04</span>
              <small>Topic</small>
            </div>
          </div>

          <label>
            Subject
            <select
              value={subjectFilter}
              onChange={(event) => {
                const value = event.target.value;
                setSubjectFilter(value);
                const first = courses.find(
                  (course) => !value || course.subject === value,
                );
                if (first) setSelected(String(first.id));
              }}
            >
              <option value="">Select subject</option>
              {subjects.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Course
            <select
              value={selected}
              onChange={(event) => selectCourse(event.target.value)}
            >
              <option value="">Choose an existing course</option>
              {filteredCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>

          <div className="inline-builder inline-builder-tight">
            <label>
              Module
              <select
                value={selectedModule}
                onChange={(event) => setSelectedModule(event.target.value)}
                disabled={!selected}
              >
                <option value="">Choose a module</option>
                {modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Topic (optional)
              <select
                value={selectedTopic}
                onChange={(event) => setSelectedTopic(event.target.value)}
                disabled={!selectedModule}
              >
                <option value="">Module-level upload</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="upload-create-stack">
            <form className="upload-inline-form" onSubmit={createModule}>
              <div className="upload-inline-form-header">
                <span className="eyebrow">CREATE MODULE</span>
                <small>Only for the selected course</small>
              </div>
              <div className="inline-builder inline-builder-tight">
                <label>
                  Module name
                  <input
                    value={moduleName}
                    onChange={(event) => setModuleName(event.target.value)}
                    placeholder="e.g. Unit 1"
                    disabled={!selected}
                  />
                </label>
                <label>
                  Optional first topic
                  <input
                    value={moduleTopicName}
                    onChange={(event) => setModuleTopicName(event.target.value)}
                    placeholder="e.g. Foundations"
                    disabled={!selected}
                  />
                </label>
              </div>
              <button
                className="button button-small button-dark"
                type="submit"
                disabled={!selected || !moduleName.trim()}
              >
                <Plus size={12} /> Create module
              </button>
            </form>

            <form className="upload-inline-form" onSubmit={createTopic}>
              <div className="upload-inline-form-header">
                <span className="eyebrow">CREATE TOPIC</span>
                <small>Optional for the selected module</small>
              </div>
              <div className="inline-builder inline-builder-tight">
                <label>
                  Topic title
                  <input
                    value={topicName}
                    onChange={(event) => setTopicName(event.target.value)}
                    placeholder="e.g. Mock Test Analysis"
                    disabled={!selectedModule}
                  />
                </label>
              </div>
              <button
                className="button button-small button-dark"
                type="submit"
                disabled={!selectedModule || !topicName.trim()}
              >
                <Plus size={12} /> Create topic
              </button>
            </form>
          </div>

          <div className="upload-destination-box">
            <span className="upload-destination-label">Upload to</span>
            <strong>
              {current?.title || "Choose a course"}
              {selectedModule && current?.modules.some((module) => String(module.id) === selectedModule)
                ? ` → ${current?.modules.find((module) => String(module.id) === selectedModule)?.title || "Selected module"}`
                : ""}
              {selectedTopic && topics.some((topic) => String(topic.id) === selectedTopic)
                ? ` → ${topics.find((topic) => String(topic.id) === selectedTopic)?.title || "Selected topic"}`
                : ""}
            </strong>
          </div>

          <form className="upload-material-form" onSubmit={addMaterial}>
            <label className="upload-dropzone" htmlFor="admin-upload-input">
              <span className="upload-dropzone-icon">
                <Upload size={22} />
              </span>
              <span className="upload-dropzone-title">Upload learning material</span>
              <span className="upload-dropzone-copy">
                PDF, DOCX, PPTX, XLSX, MP4, ZIP, images and more
              </span>
              <span className="upload-dropzone-button">Choose file(s)</span>
              <input
                id="admin-upload-input"
                key={fileInputKey}
                type="file"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                required
              />
            </label>

            <div className="upload-selected-file">
              <span className="upload-file-dot">📄</span>
              <div>
                <strong>
                  {files.length === 0
                    ? "No file selected"
                    : files.length === 1
                      ? files[0].name
                      : `${files.length} files selected`}
                </strong>
                <small>
                  {files.length === 0
                    ? "Select files to continue"
                    : files.length === 1
                      ? `${(files[0].size / 1024 / 1024).toFixed(1)} MB`
                      : `${files.length} files ready to upload`}
                </small>
              </div>
            </div>

            <div className="upload-actions-row">
              <button
                className="button button-dark"
                type="submit"
                disabled={files.length === 0 || !selected || !selectedModule}
              >
                <Upload size={14} /> Upload {files.length > 1 ? "files" : "file"}
              </button>
            </div>
          </form>
        </div>
      </div>

      <section className="material-library">
        <div className="library-heading">
          <div>
            <span className="eyebrow">DIRECTORY</span>
            <h3>Modules, topics &amp; files</h3>
            <small>
              Everything currently stored under {current ? current.title : "this course"}
            </small>
          </div>
          <div className="directory-filter-tools" role="search">
            <div className="course-module-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={directorySearch}
                onChange={(event) => setDirectorySearch(event.target.value)}
                placeholder="Search modules, topics or files"
                aria-label="Search modules, topics or files"
              />
            </div>
            <select value={directoryFilter} onChange={(event) => setDirectoryFilter(event.target.value as typeof directoryFilter)} aria-label="Filter directory modules">
              <option value="all">All modules</option>
              <option value="with-files">With files</option>
            </select>
            <select value={directoryTypeFilter} onChange={(event) => setDirectoryTypeFilter(event.target.value)} aria-label="Filter files by type">
              <option value="all">All file types</option>
              <option value="pdf">PDF</option>
              <option value="document">Documents</option>
              <option value="presentation">Presentations</option>
              <option value="image">Images</option>
              <option value="audio">Audio</option>
              <option value="video">Video</option>
            </select>
          </div>
        </div>

        <div className="directory-admin-tree">
          {filteredGroupedModules.map((module) => {
            const moduleTotalFiles = (module.topics || []).reduce(
              (count, topic) => count + (topic.resources || []).length,
              0,
            );

            return (
              <div className="directory-admin-module" key={module.id}>
                <div className="directory-admin-line directory-admin-module-header">
                  <span className="directory-bullet directory-bullet-module">📁</span>
                  <div className="directory-name-wrap">
                    <b>{module.title}</b>
                    <small>{moduleTotalFiles} files</small>
                  </div>
                  <div className="directory-action-row">
                    <button
                      type="button"
                      className="button button-small"
                      onClick={() => {
                        setSelectedModule(String(module.id));
                        setSelectedTopic("");
                        requestAnimationFrame(() => {
                          document.getElementById("admin-upload-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
                        });
                      }}
                    >
                      <Plus size={12} /> Add file
                    </button>
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => openRenameTarget({ kind: "module", id: module.id, title: module.title })}
                      aria-label={`Rename module ${module.title}`}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="button-link button-danger"
                      onClick={() => void deleteModule(module.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {(module.topics || []).length ? (
                  <div className="directory-topic-group">
                    {(module.topics || []).map((topic) => {
                      const topicResources = topic.resources || [];
                      const resourcePageSize = directoryResourcePageSizes[topic.id] || 10;
                      const resourceTotalPages = Math.max(1, Math.ceil(topicResources.length / resourcePageSize));
                      const resourcePage = Math.min(directoryResourcePages[topic.id] || 1, resourceTotalPages);
                      const visibleTopicResources = topicResources.slice(
                        (resourcePage - 1) * resourcePageSize,
                        resourcePage * resourcePageSize,
                      );
                      const resourcePageNumbers = Array.from({ length: resourceTotalPages }, (_, index) => index + 1);

                      return (
                      <div className="directory-admin-topic" key={topic.id}>
                        <div className="directory-admin-line directory-admin-topic-header">
                          <span className="directory-bullet directory-bullet-topic">📂</span>
                          <div className="directory-name-wrap">
                            <b>{topic.title}</b>
                            <small>{(topic.resources || []).length} files</small>
                          </div>
                          <div className="directory-action-row">
                            <button
                              type="button"
                              className="button button-small"
                              onClick={() => {
                                setSelectedModule(String(module.id));
                                setSelectedTopic(String(topic.id));
                                requestAnimationFrame(() => {
                                  document.getElementById("admin-upload-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
                                });
                              }}
                            >
                              <Plus size={12} /> Add file
                            </button>
                            <button
                              type="button"
                              className="button-link"
                              onClick={() => openRenameTarget({ kind: "topic", id: topic.id, title: topic.title })}
                              aria-label={`Rename topic ${topic.title}`}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              className="button-link button-danger"
                              onClick={() => void deleteTopic(topic.id)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {topicResources.length ? (
                          <div className="directory-file-list">
                            {visibleTopicResources.map((resource) => (
                              <div className="material-row" key={resource.id}>
                                {(() => {
                                  const filename = resource.original_filename || resource.title || "Unnamed file";
                                  const extension = filename.split(".").pop()?.toUpperCase() || resource.resource_type.toUpperCase() || "FILE";
                                  const fileType = extension.length <= 5 ? extension : resource.resource_type.toUpperCase();
                                  return (
                                    <>
                                <span className="resource-type-badge">
                                  {fileType}
                                </span>
                                <div className="directory-file-meta">
                                  <strong title={filename}>{filename}</strong>
                                  <small>
                                    {resource.title && resource.title !== resource.original_filename ? `${resource.title} · ` : ""}{module.title} / {topic.title}
                                  </small>
                                </div>
                                <div className="resource-actions">
                                  <button
                                    className="button-link"
                                    type="button"
                                    onClick={() => void renameResource(resource.id, resource.title)}
                                  >
                                    Rename
                                  </button>
                                  <button
                                    className="button-link"
                                    type="button"
                                    onClick={() => void showVersions(resource.id)}
                                  >
                                    History
                                  </button>
                                  <button
                                    className="button-link button-danger"
                                    type="button"
                                    onClick={() => void deleteResource(resource.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                                <label className="replace-file">
                                  <span>Replace</span>
                                  <input
                                    type="file"
                                    onChange={(event) => replace(resource.id, event)}
                                  />
                                </label>
                                <select
                                  className="resource-move-select"
                                  value={String(topic.id)}
                                  onChange={(event) =>
                                    void moveResource(resource.id, event.target.value)
                                  }
                                >
                                  {allTopics.map((topicItem) => (
                                    <option key={topicItem.id} value={String(topicItem.id)}>
                                      {topicItem.courseTitle} / {topicItem.moduleTitle} / {topicItem.title}
                                    </option>
                                  ))}
                                </select>
                                    </>
                                  );
                                })()}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-module-note">No files in this topic yet.</div>
                        )}
                        {topicResources.length > 0 && (
                          <div className="resource-pagination admin-resource-pagination" aria-label={`${topic.title} admin resources pagination`}>
                            <div className="resource-page-size">
                              <label htmlFor={`admin-resource-page-size-${topic.id}`}>Files per page</label>
                              <select
                                id={`admin-resource-page-size-${topic.id}`}
                                value={resourcePageSize}
                                onChange={(event) => {
                                  setDirectoryResourcePageSizes((current) => ({ ...current, [topic.id]: Number(event.target.value) }));
                                  setDirectoryResourcePages((current) => ({ ...current, [topic.id]: 1 }));
                                }}
                              >
                                {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                              </select>
                            </div>
                            {resourceTotalPages > 1 && (
                              <div className="resource-page-controls">
                                <button
                                  type="button"
                                  className="button button-small"
                                  disabled={resourcePage === 1}
                                  onClick={() => setDirectoryResourcePages((current) => ({ ...current, [topic.id]: Math.max(1, resourcePage - 1) }))}
                                >
                                  <ChevronLeft size={14} /> Previous
                                </button>
                                <div className="resource-page-numbers">
                                  {resourcePageNumbers.map((pageNumber) => (
                                    <button
                                      type="button"
                                      key={pageNumber}
                                      className={`resource-page-pill ${pageNumber === resourcePage ? "is-active" : ""}`}
                                      aria-label={`Resource page ${pageNumber}`}
                                      aria-current={pageNumber === resourcePage ? "page" : undefined}
                                      onClick={() => setDirectoryResourcePages((current) => ({ ...current, [topic.id]: pageNumber }))}
                                    >
                                      {pageNumber}
                                    </button>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  className="button button-small"
                                  disabled={resourcePage === resourceTotalPages}
                                  onClick={() => setDirectoryResourcePages((current) => ({ ...current, [topic.id]: Math.min(resourceTotalPages, resourcePage + 1) }))}
                                >
                                  Next <ChevronRight size={14} />
                                </button>
                              </div>
                            )}
                            <span className="resource-page-status">
                              Showing {(resourcePage - 1) * resourcePageSize + 1}–{Math.min(resourcePage * resourcePageSize, topicResources.length)} of {topicResources.length} files
                            </span>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-module-note">
                    No topics yet. Files can be uploaded directly to this module.
                  </div>
                )}
              </div>
            );
          })}
          {!filteredGroupedModules.length && <div className="empty-state">No modules, topics or files match your filter.</div>}
        </div>

        {!materials.length && (
          <div className="sidebar-empty">No files in this course yet.</div>
        )}
      </section>
    </div>
  );
}

function AdminPayments({ user }: { user: User | null }) {
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "paid" | "pending" | "failed"
  >("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 6;

  const load = () =>
    api<AdminPayment[]>("/admin/payments")
      .then((items) => {
        setPayments(items);
        setError("");
      })
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setLoading(false));

  useEffect(() => {
    if (user?.role !== "admin") return;
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [user]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  if (!user || user.role !== "admin")
    return (
      <div className="container">
        <div className="empty-state">
          <ShieldCheck size={26} />
          <h2>Admin access only.</h2>
        </div>
      </div>
    );

  const filtered = payments.filter((payment) => {
    const matchesStatus =
      statusFilter === "all" || payment.status === statusFilter;
    const haystack =
      `${payment.receipt_id} ${payment.user_name} ${payment.user_email} ${payment.product}`.toLowerCase();
    const matchesQuery =
      !query.trim() || haystack.includes(query.trim().toLowerCase());
    return matchesStatus && matchesQuery;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedPayments = filtered.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);
  const totalPaise = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <div className="container admin-page">
      <div className="admin-head">
        <div>
          <span className="eyebrow">PAYMENTS</span>
          <h1>Receipts &amp; transactions.</h1>
          <p>
            Every Razorpay and mock-mode payment attempt, most recent first.
          </p>
        </div>
        <span className="admin-badge">
          <CheckCircle2 size={17} />
          admin only
        </span>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="admin-stats">
        <div className="admin-stat">
          <small>Total collected</small>
          <b>₹{(totalPaise / 100).toLocaleString("en-IN")}</b>
          <span>from paid receipts</span>
        </div>
        <div className="admin-stat">
          <small>Paid</small>
          <b>
            {payments.filter((payment) => payment.status === "paid").length}
          </b>
          <span>successful</span>
        </div>
        <div className="admin-stat">
          <small>Pending</small>
          <b>
            {payments.filter((payment) => payment.status === "pending").length}
          </b>
          <span>awaiting verification</span>
        </div>
        <div className="admin-stat">
          <small>Failed</small>
          <b>
            {payments.filter((payment) => payment.status === "failed").length}
          </b>
          <span>cancelled or declined</span>
        </div>
      </div>
      <section className="admin-course-list payments-ledger">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">LEDGER</span>
            <h2>Completed &amp; pending receipts</h2>
          </div>
          <div className="payments-toolbar">
            <input
              className="payments-search"
              placeholder="Search receipt, name, email…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as typeof statusFilter)
              }
            >
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
        {loading ? (
          <div className="empty-state">Loading payments…</div>
        ) : filtered.length ? (
          <>
            {paginatedPayments.map((payment) => (
            <div className="admin-course-row" key={payment.id}>
              <div>
                <div className="admin-course-row-title">
                  <CheckCircle2 size={16} />
                  <b>{payment.receipt_id}</b>
                  <span
                    className={
                      payment.status === "paid"
                        ? "published-pill"
                        : payment.status === "failed"
                          ? "draft-pill"
                          : "draft-pill"
                    }
                  >
                    {payment.status}
                  </span>
                  {payment.status === "paid" && payment.enrollment_status && (
                    <span className="published-pill">
                      {payment.enrollment_status}
                    </span>
                  )}
                </div>
                <small>
                  {payment.user_name} · {payment.user_email} · {payment.product}
                  {payment.course_id ? ` · course #${payment.course_id}` : ""}
                  {payment.access_expires_at
                    ? ` · access until ${new Date(payment.access_expires_at).toLocaleDateString("en-IN")}`
                    : payment.status === "paid"
                      ? " · lifetime access"
                      : ""}
                </small>
              </div>
              <div className="admin-course-actions">
                <b>₹{(payment.amount / 100).toLocaleString("en-IN")}</b>
                <small>
                  {payment.paid_at
                    ? new Date(payment.paid_at).toLocaleString("en-IN")
                    : "Not paid"}
                </small>
              </div>
            </div>
            ))}
            {totalPages > 1 && (
              <div className="pagination-row" aria-label="Admin payments pagination">
                <button
                  type="button"
                  className="button button-small button-outline"
                  disabled={safePage === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft size={14} /> Previous
                </button>
                <div className="pagination-pages" aria-live="polite">
                  {pageNumbers.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      className={`button button-small ${safePage === pageNumber ? "button-dark" : "button-outline"}`}
                      onClick={() => setPage(pageNumber)}
                    >
                      {pageNumber}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="button button-small button-outline"
                  disabled={safePage === totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="sidebar-empty">
            No payment records match this filter.
          </div>
        )}
      </section>
    </div>
  );
}

type MeetClassSummary = {
  id: number;
  course_id: number;
  title: string;
  teacher_name: string;
  provider: string;
  status: string;
  can_join: boolean;
  scheduled_at: string;
  recording_status?: string | null;
  meet_link?: string | null;
};

type MeetJoin = {
  live_class_id: number;
  title: string;
  teacher_name: string;
  provider: string;
  status: string;
  launch_token: string | null;
};

function openProtectedMeet(liveClassId: number, launchToken: string | null) {
  if (!launchToken) throw new Error("This class is not broadcasting yet.");
  window.location.assign(
    `${API_URL}/live-classes/${liveClassId}/open?token=${encodeURIComponent(launchToken)}`,
  );
}

function startGoogleLoginForClass(liveClassId: number) {
  sessionStorage.setItem("pending_live_class", String(liveClassId));
  window.location.assign(`${API_URL}/auth/google/login`);
}

function needsGoogleLogin(cause: unknown) {
  return (
    (cause instanceof ApiError && cause.status === 403) ||
    ((cause as Error).message?.toLowerCase().includes("sign in with google") ??
      false)
  );
}

function GoogleAuthModal({ onClose }: { onClose: () => void }) {
  const continueWithGoogle = () => {
    window.location.assign(`${API_URL}/auth/google/login`);
  };

  return (
    <div
      className="google-auth-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="google-auth-title"
    >
      <div className="google-auth-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="google-auth-modal-card">
        <button
          className="google-auth-close"
          type="button"
          aria-label="Close Google authentication prompt"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <div className="google-auth-mark" aria-hidden="true">
          G
        </div>
        <h2 id="google-auth-title">Authenticate with Google to join.</h2>
        <p>
          Google authentication is required to join this live classroom and
          access its protected recording.
        </p>
        <button type="button" className="button button-cyan full" onClick={continueWithGoogle}>
          Continue with Google <ArrowRight size={15} />
        </button>
        <button type="button" className="button-link google-auth-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CourseLiveClasses({
  courseId,
  courseSlug = window.location.pathname.startsWith("/course/")
    ? window.location.pathname.slice("/course/".length)
    : String(courseId),
  user,
  courseAccess = false,
}: {
  courseId: number;
  courseSlug?: string;
  user: User | null;
  courseAccess?: boolean;
}) {
  const [classes, setClasses] = useState<MeetClassSummary[]>([]);
  const [error, setError] = useState("");
  const [googleAuthOpen, setGoogleAuthOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const refresh = () =>
      api<MeetClassSummary[]>("/live-classes/available")
        .then((items) =>
          setClasses(items.filter((item) => item.course_id === courseId)),
        )
        .catch((cause) => setError((cause as Error).message));
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [courseId, user]);

  const join = async (id: number) => {
    try {
      setError("");
      const result = await api<MeetJoin>(`/live-classes/${id}/join`, {
        method: "POST",
      });
      openProtectedMeet(id, result.launch_token);
    } catch (cause) {
      if (needsGoogleLogin(cause)) {
        setGoogleAuthOpen(true);
        return;
      }
      setError((cause as Error).message);
    }
  };

  const classroomClasses = classes.filter((item) =>
    ["SCHEDULED", "STARTING", "LIVE"].includes(item.status),
  );
  const recordings = classes.filter(
    (item) => item.recording_status === "COMPLETED",
  );
  if (!user || (classroomClasses.length === 0 && recordings.length === 0))
    return null;
  if (!courseAccess) {
    return (
      <section className="course-live-section">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">COURSE CLASSROOM</span>
            <h2>Live and recorded classes</h2>
          </div>
          <span className="muted">Enrollment required</span>
        </div>
        <div className="notice premium-paywall">
          <b>Enroll in this course to unlock the classroom</b>
          <span>
            Google Meet links and recordings are available only for learners
            enrolled in this course.
          </span>
          <Link className="button button-cyan button-small" to={`/payment/course/${courseSlug}`}>
            Register and pay <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    );
  }
  return (
    <>
      {googleAuthOpen && (
        <GoogleAuthModal onClose={() => setGoogleAuthOpen(false)} />
      )}
      <section className="course-live-section">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">COURSE CLASSROOM</span>
            <h2>Live and recorded classes</h2>
          </div>
          <span className="muted">Access controlled</span>
        </div>
        {error && <div className="notice">{error}</div>}
        {classroomClasses.length > 0 && (
          <div className="youtube-class-grid">
            {classroomClasses.map((item) => (
              <LiveClassCard
                key={item.id}
                data={{
                  id: item.id,
                  title: item.title,
                  teacherName: item.teacher_name,
                  status: item.status,
                  canJoin: item.can_join,
                  scheduledAt: item.scheduled_at,
                  recordingStatus: item.recording_status,
                  meetLink: item.meet_link,
                }}
                onJoin={join}
              />
            ))}
          </div>
        )}
        {classroomClasses
          .filter((item) => item.can_join)
          .map((item) => (
            <LiveClassRoomPanel key={`room-${item.id}`} liveClassId={item.id} />
          ))}
        {recordings.length > 0 && (
          <div className="recording-grid course-recordings">
            {recordings.map((item) => (
              <RecordingCard
                key={item.id}
                data={{
                  liveClassId: item.id,
                  title: item.title,
                  topic: item.title,
                  date: item.scheduled_at,
                  paymentUrl: `/payment/course/${courseSlug}`,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function UnifiedLivePage({ user }: { user: User | null }) {
  const [classes, setClasses] = useState<MeetClassSummary[]>([]);
  const [error, setError] = useState("");
  const [googleAuthOpen, setGoogleAuthOpen] = useState(false);

  const refresh = async () => {
    try {
      const [items, courses] = await Promise.all([
        api<MeetClassSummary[]>("/live-classes/available"),
        api<Course[]>("/courses/dashboard"),
      ]);
      const enrolledCourseIds = new Set(
        courses.filter((course) => course.is_enrolled).map((course) => course.id),
      );
      setClasses(items.filter((item) => enrolledCourseIds.has(item.course_id)));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  useEffect(() => {
    if (!user) return;
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [user]);

  const join = async (id: number) => {
    try {
      const result = await api<MeetJoin>(`/live-classes/${id}/join`, {
        method: "POST",
      });
      openProtectedMeet(id, result.launch_token);
    } catch (cause) {
      if (needsGoogleLogin(cause)) {
        setGoogleAuthOpen(true);
        return;
      }
      setError((cause as Error).message);
    }
  };

  if (!user)
    return (
      <div className="container">
        <div className="empty-state">
          <Radio size={26} />
          <h2>Google Meet classroom.</h2>
          <p>Sign in to join live classes assigned to your course.</p>
          <Link to="/login" className="button button-dark">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  const recordings = classes.filter(
    (item) => item.recording_status === "COMPLETED",
  );
  return (
    <>
      {googleAuthOpen && (
        <GoogleAuthModal onClose={() => setGoogleAuthOpen(false)} />
      )}
      <div className="container live-page youtube-live-page">
        <div className="live-head">
          <div>
            <span className="eyebrow">
              <span className="live-pulse" /> GOOGLE MEET CLASSROOM
            </span>
            <h1>Live classes, replayable notes.</h1>
            <p>
              Join your teacher's Google Meet classroom from the protected
              learner portal.
            </p>
          </div>
          <div className="latency-card">
            <Radio size={18} />
            <span>
              <b>Access controlled</b>
              <small>Active course enrollment required</small>
            </span>
          </div>
        </div>
        {error && <div className="notice">{error}</div>}
        <section className="youtube-class-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">GOOGLE MEET</span>
              <h2>Upcoming and active classes.</h2>
            </div>
            <span className="muted">Direct Meet access</span>
          </div>
          <div className="youtube-class-grid">
            {classes.length ? (
              classes.map((item) => (
                <LiveClassCard
                  key={item.id}
                  data={{
                    id: item.id,
                    title: item.title,
                    teacherName: item.teacher_name,
                    status: item.status,
                    canJoin: item.can_join,
                    scheduledAt: item.scheduled_at,
                    recordingStatus: item.recording_status,
                    meetLink: item.meet_link,
                  }}
                  onJoin={join}
                />
              ))
            ) : (
              <div className="sidebar-empty">
                No Google Meet classes are available yet.
              </div>
            )}
          </div>
          {classes
            .filter(
              (item) =>
                item.can_join && ["STARTING", "LIVE"].includes(item.status),
            )
            .map((item) => (
              <LiveClassRoomPanel
                key={`room-${item.id}`}
                liveClassId={item.id}
              />
            ))}
        </section>
        {recordings.length > 0 && (
          <section className="youtube-class-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">DRIVE REPLAYS</span>
                <h2>Watch a completed class.</h2>
              </div>
            </div>
            <div className="recording-grid">
              {recordings.map((item) => (
                <RecordingCard
                  key={item.id}
                  data={{
                    liveClassId: item.id,
                    title: item.title,
                    topic: item.title,
                    date: item.scheduled_at,
                    paymentUrl: `/course/${item.course_id}`,
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function FullLiveClassPage({ user }: { user: User | null }) {
  const { liveClassId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [access, setAccess] = useState<PremiumAccess | null>(null);

  useEffect(() => {
    if (!user || !liveClassId) return;
    void api<PremiumAccess>("/payments/status")
      .then(setAccess)
      .catch(() => undefined);
    api<MeetJoin>(`/live-classes/${liveClassId}/join`, { method: "POST" })
      .then((result) => {
        openProtectedMeet(Number(liveClassId), result.launch_token);
      })
      .catch((cause) => {
        if (needsGoogleLogin(cause)) {
          startGoogleLoginForClass(Number(liveClassId));
          return;
        }
        setError((cause as Error).message);
      });
  }, [liveClassId, user]);

  if (!user)
    return (
      <div className="container">
        <div className="empty-state">
          <Radio size={26} />
          <h2>Sign in to watch this class.</h2>
          <Link to="/login" className="button button-dark">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  return (
    <div className="full-live-page">
      <div className="full-live-toolbar">
        <button className="button button-small" onClick={() => navigate(-1)}>
          Back to live classes
        </button>
        <span className="eyebrow">
          <span className="live-pulse" /> GOOGLE MEET CLASSROOM
        </span>
      </div>
      {error && <div className="notice">{error}</div>}
      {error.toLowerCase().includes("premium") ||
      error.toLowerCase().includes("free live") ? (
        <PremiumPaywall
          access={access}
          feature="live"
          onPaid={() => window.location.reload()}
        />
      ) : null}
      {!error && (
        <div className="empty-state">
          <Radio size={26} />
          <h2>Opening Google Meet…</h2>
          <p>
            Your enrollment is checked first, then the protected classroom link
            opens.
          </p>
        </div>
      )}
    </div>
  );
}

type AdminRecordedVideo = {
  id: number;
  drive_file_id: string;
  file_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  drive_created_at?: string | null;
  drive_modified_at?: string | null;
  duration_seconds?: number | null;
  live_class_id?: number | null;
  live_class_title?: string | null;
  status: string;
  matching_source?: string | null;
  match_confidence?: string | null;
  available?: boolean;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function AdminRecordedVideosPage({ user }: { user: User | null }) {
  const notifications = useNotifications();
  const [records, setRecords] = useState<AdminRecordedVideo[]>([]);
  const [liveClasses, setLiveClasses] = useState<LiveClass[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [summary, setSummary] = useState({ total: 0, assigned: 0, unassigned: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [tab, setTab] = useState<"all" | "assigned" | "needs-assignment">("all");
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [assignmentCourseByRecord, setAssignmentCourseByRecord] = useState<Record<number, string>>({});
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [previewItem, setPreviewItem] = useState<AdminRecordedVideo | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const pageSize = 8;

  const load = async () => {
    setLoading(true);
    try {
      const [items, stats, classes, allCourses] = await Promise.all([
        api<AdminRecordedVideo[]>("/admin/recorded-videos"),
        api<{ total: number; assigned: number; unassigned: number }>("/admin/recorded-videos/summary"),
        api<LiveClass[]>("/live-classes"),
        api<Course[]>("/admin/courses"),
      ]);
      setRecords(items);
      setSummary(stats);
      setLiveClasses(classes);
      setCourses(allCourses);
      setError("");
    } catch (cause) {
      setError((cause as Error).message || "Unable to load recorded videos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role !== "admin") return;
    void load();
  }, [user]);

  useEffect(() => {
    setPage(1);
  }, [tab, search, courseFilter, statusFilter, sortBy]);

  const courseOptions = useMemo(() => {
    const ids = new Set<number>();
    for (const item of liveClasses) {
      if (item.course_id) ids.add(item.course_id);
    }
    return courses
      .filter((course) => ids.has(course.id))
      .map((course) => ({ id: course.id, title: course.title }));
  }, [courses, liveClasses]);

  const normalizedRecords = useMemo(() => {
    return records.map((record) => {
      const liveClass = liveClasses.find((item) => item.id === record.live_class_id) || null;
      const course = liveClass ? courses.find((item) => item.id === liveClass.course_id) || null : null;
      return {
        ...record,
        courseTitle: course?.title || "",
        courseId: course?.id ?? null,
        liveClassTitle: record.live_class_title || liveClass?.title || "Unassigned",
      };
    });
  }, [courses, liveClasses, records]);

  const visibleRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = normalizedRecords.filter((record) => {
      const matchesTab =
        tab === "all" ||
        (tab === "assigned" && (record.status === "ASSIGNED" || Boolean(record.live_class_id))) ||
        (tab === "needs-assignment" && (!record.live_class_id || record.status === "UNASSIGNED"));
      const matchesSearch = !query || `${record.file_name} ${record.courseTitle} ${record.liveClassTitle}`.toLowerCase().includes(query);
      const matchesCourse = courseFilter === "all" || String(record.courseId ?? "") === courseFilter || String(record.live_class_id ?? "") === courseFilter;
      const matchesStatus = statusFilter === "all" || record.status === statusFilter;
      return matchesTab && matchesSearch && matchesCourse && matchesStatus;
    });

    return [...filtered].sort((left, right) => {
      const leftDate = left.drive_created_at ? Date.parse(left.drive_created_at) : new Date(left.created_at || 0).getTime();
      const rightDate = right.drive_created_at ? Date.parse(right.drive_created_at) : new Date(right.created_at || 0).getTime();
      if (sortBy === "name") {
        return (left.file_name || "").localeCompare(right.file_name || "");
      }
      return sortBy === "oldest" ? leftDate - rightDate : rightDate - leftDate;
    });
  }, [courseFilter, normalizedRecords, search, sortBy, statusFilter, tab]);

  const totalPages = Math.max(1, Math.ceil(visibleRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRecords = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return visibleRecords.slice(start, start + pageSize);
  }, [safePage, visibleRecords]);

  const syncNow = async () => {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ checked: number; assigned: number; unassigned: number; message: string }>("/admin/recorded-videos/sync", { method: "POST" });
      setNotice(`${result.message}. ${result.checked} videos checked, ${result.assigned} assigned, ${result.unassigned} need review.`);
      notifications.showToast({ kind: "success", title: "Recordings synced", message: `${result.checked} videos checked and ${result.assigned} assigned.` });
      await load();
    } catch (cause) {
      setError((cause as Error).message || "Unable to sync recordings right now. Please try again shortly.");
      notifications.showToast({ kind: "error", title: "Recording sync failed", message: (cause as Error).message || "Unable to sync recordings." });
    } finally {
      setSyncing(false);
    }
  };

  const assignRecording = async (recordId: number, liveClassId: string) => {
    const selectedId = Number(liveClassId);
    if (!selectedId) return;
    setAssigningId(recordId);
    setError("");
    setNotice("");
    try {
      await api(`/admin/recorded-videos/${recordId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ live_class_id: selectedId }),
      });
      setNotice("Recording assigned successfully.");
      notifications.showToast({ kind: "success", title: "Recording assigned", message: "The recording is now linked to the selected live class." });
      await load();
    } catch (cause) {
      setError((cause as Error).message || "Unable to assign this recording. Please try again.");
      notifications.showToast({ kind: "error", title: "Assignment failed", message: (cause as Error).message || "Unable to assign this recording." });
    } finally {
      setAssigningId(null);
    }
  };

  const assignToCourse = async (recordId: number, courseId: string) => {
    const targetCourseId = Number(courseId);
    if (!targetCourseId) {
      setError("Please select a course before assigning this recording.");
      return;
    }

    const matchingClass = liveClasses.find((item) => Number(item.course_id) === targetCourseId);
    if (!matchingClass) {
      setError("No live class is available for this course yet.");
      return;
    }

    setAssignmentCourseByRecord((current) => ({ ...current, [recordId]: String(targetCourseId) }));
    await assignRecording(recordId, String(matchingClass.id));
  };

  const openPreview = async (record: AdminRecordedVideo) => {
    setPreviewBusy(true);
    setPreviewUrl("");
    try {
      const result = await api<{ url: string }>(`/library/recorded-videos/${record.drive_file_id}/drive-view`, { method: "POST" });
      setPreviewItem(record);
      setPreviewUrl(result.url);
    } catch (cause) {
      setError((cause as Error).message || "Unable to load the preview right now.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1); 

  if (!user || user.role !== "admin") {
    return (
      <div className="container">
        <div className="empty-state">
          <ShieldCheck size={26} />
          <h2>Admin access only.</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="container admin-page" style={{ paddingBottom: 32 }}>
      <div className="admin-head" style={{ alignItems: "center" }}>
        <div>
          <span className="eyebrow">RECORDED VIDEOS</span>
          <h1 style={{ margin: "8px 0 4px" }}>Recorded Videos</h1>
          <p style={{ margin: 0 }}>Manage, assign and organize Live Class recordings.</p>
        </div>
        <button
          className="button button-dark"
          disabled={syncing}
          onClick={() => void syncNow()}
          style={{ minWidth: 180 }}
        >
          <RefreshCw size={15} className={syncing ? "spin" : ""} />
          {syncing ? "Syncing..." : "Sync Google Drive"}
        </button>
      </div>

      {notice && (
        <div className="notice notice-success" style={{ marginTop: 14 }}>
          <Check size={16} />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="notice notice-error" style={{ marginTop: 14 }}>
          <span>{error}</span>
        </div>
      )}

      <div className="admin-stats" style={{ marginTop: 18 }}>
        <div className="admin-stat">
          <small>Total Videos</small>
          <b>{summary.total || records.length}</b>
          <span>recordings</span>
        </div>
        <div className="admin-stat">
          <small>Assigned</small>
          <b>{summary.assigned || records.filter((item) => item.status === "ASSIGNED" || Boolean(item.live_class_id)).length}</b>
          <span>matched</span>
        </div>
        <div className="admin-stat">
          <small>Unassigned</small>
          <b>{summary.unassigned || records.filter((item) => !item.live_class_id || item.status === "UNASSIGNED").length}</b>
          <span>needs review</span>
        </div>
      </div>

      <section className="panel" style={{ padding: 18, marginTop: 22, borderRadius: 18 }}>
        <div
          className="recorded-admin-toolbar"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px, 1.7fr) repeat(4, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid rgba(148,163,184,0.22)",
              borderRadius: 12,
              background: "rgba(248,250,252,0.7)",
              padding: "0 14px",
              minHeight: 46,
            }}
          >
            <Search size={16} style={{ color: "#64748b", marginRight: 8 }} />
            <input
              className="payments-search"
              placeholder="Search recordings..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{
                width: "100%",
                background: "transparent",
                border: 0,
                outline: "none",
                fontSize: 15,
                color: "#0f172a",
              }}
            />
          </div>

          <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} style={{ minHeight: 46 }}>
            <option value="all">Course</option>
            {courseOptions.map((course) => (
              <option key={course.id} value={String(course.id)}>{course.title}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={{ minHeight: 46 }}>
            <option value="all">Status</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="UNASSIGNED">Needs Assignment</option>
          </select>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} style={{ minHeight: 46 }}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
          </select>
        </div>

        <div className="section-heading compact" style={{ marginTop: 18, marginBottom: 16, alignItems: "center" }}>
          <div>
            <span className="eyebrow">MANAGE</span>
            <h2 style={{ margin: "6px 0 0" }}>Manage recordings</h2>
          </div>
          <div className="tab-row" role="tablist" aria-label="Recorded video tabs" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { key: "all", label: "All" },
              { key: "assigned", label: "Assigned" },
              { key: "needs-assignment", label: "Needs Assignment" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`button button-small ${tab === item.key ? "button-dark" : "button-outline"}`}
                onClick={() => setTab(item.key as typeof tab)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Loading recordings…</div>
        ) : !visibleRecords.length ? (
          <div className="empty-state" style={{ padding: 28 }}>
            <Play size={26} />
            <h3>No recorded videos found.</h3>
            <p>Use Sync Google Drive to discover recordings.</p>
          </div>
        ) : (
          <>
            <div className="recorded-admin-grid" style={{ display: "grid", gap: 14 }}>
              {paginatedRecords.map((record) => {
                const isAssigned = Boolean(record.live_class_id) || record.status === "ASSIGNED";
                const selectedAssignment = String(record.live_class_id ?? "");
                const dateText = record.drive_created_at ? new Date(record.drive_created_at).toLocaleDateString("en-IN") : "Date unavailable";
                const sizeText = record.file_size ? `${(record.file_size / (1024 * 1024)).toFixed(1)} MB` : "Size unavailable";

                return (
                  <article
                    key={record.id}
                    className="recorded-admin-card panel"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "220px minmax(0, 1fr)",
                      gap: 18,
                      padding: 14,
                      borderRadius: 16,
                      alignItems: "center",
                    }}
                  >
                    <div
                      className="recorded-admin-thumb"
                      aria-label={record.file_name}
                      style={{
                        position: "relative",
                        height: 150,
                        borderRadius: 14,
                        background: "linear-gradient(135deg, #0b1f2c 0%, #1e3a5f 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        boxShadow: "inset 0 0 0 1px rgba(148,163,184,0.1)",
                      }}
                    >
                      <div
                        style={{
                          width: 76,
                          height: 76,
                          borderRadius: "50%",
                          background: "linear-gradient(135deg, #3b82f6, #67e8f9)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 12px 28px rgba(59,130,246,0.4)",
                        }}
                      >
                        <Play size={28} color="#fff" fill="white" />
                      </div>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, color: "#64748b", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>
                            {record.courseTitle || "Course"}
                          </div>
                          <strong style={{ display: "block", fontSize: 18, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {record.file_name}
                          </strong>
                        </div>
                        <span
                          className={`recorded-pill ${isAssigned ? "success" : "warn"}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "6px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            background: isAssigned ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                            color: isAssigned ? "#047857" : "#b45309",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isAssigned ? "Assigned" : "Needs Assignment"}
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", color: "#475569", fontSize: 13, marginBottom: 12 }}>
                        <span>{dateText}</span>
                        <span>{sizeText}</span>
                        {record.duration_seconds ? <span>{Math.round(record.duration_seconds / 60)} min</span> : null}
                      </div>

                      {isAssigned ? (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
                            <div style={{ fontSize: 13, color: "#475569" }}>
                              <strong style={{ color: "#0f172a" }}>Course:</strong> {record.courseTitle || "Course unavailable"}
                            </div>
                            {record.liveClassTitle ? (
                              <div style={{ fontSize: 13, color: "#475569" }}>
                                <strong style={{ color: "#0f172a" }}>Live Class:</strong> {record.liveClassTitle}
                              </div>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                            <button className="button button-small button-outline" type="button" onClick={() => void openPreview(record)} disabled={previewBusy}>
                              Preview
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
                            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#475569", fontWeight: 600 }}>
                              Course
                              <select
                                value={assignmentCourseByRecord[record.id] ?? ""}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setAssignmentCourseByRecord((current) => ({ ...current, [record.id]: nextValue }));
                                }}
                              >
                                <option value="">Select Course</option>
                                {courses.map((course) => (
                                  <option key={course.id} value={String(course.id)}>{course.title}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button
                              className="button button-small button-dark"
                              type="button"
                              onClick={async () => {
                                const selectedCourse = assignmentCourseByRecord[record.id] ?? (courseFilter === "all" ? "" : courseFilter);
                                if (!selectedCourse) {
                                  setError("Please choose a course before assigning this recording.");
                                  return;
                                }
                                await assignToCourse(record.id, selectedCourse);
                              }}
                              disabled={assigningId === record.id}
                            >
                              {assigningId === record.id ? "Assigning..." : "Assign Recording"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div
                className="admin-pagination"
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 24,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="button button-small button-outline"
                  disabled={safePage === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft size={14} /> Previous
                </button>

                {pageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    className={`button button-small ${safePage === pageNumber ? "button-dark" : "button-outline"}`}
                    onClick={() => setPage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                ))}

                <button
                  type="button"
                  className="button button-small button-outline"
                  disabled={safePage === totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {previewItem && (
        <div className="google-auth-modal" role="dialog" aria-modal="true" aria-labelledby="recording-preview-title">
          <div className="google-auth-backdrop" aria-hidden="true" onClick={() => setPreviewItem(null)} />
          <div className="google-auth-modal-card" style={{ maxWidth: "900px", width: "min(90vw, 900px)" }}>
            <button className="google-auth-close" type="button" aria-label="Close preview" onClick={() => setPreviewItem(null)}>
              <X size={18} />
            </button>
            <h2 id="recording-preview-title">Preview recording</h2>
            <p>{previewItem.file_name}</p>
            {previewUrl ? (
              <video
                src={previewUrl}
                controls
                playsInline
                autoPlay
                style={{ width: "100%", maxHeight: "65vh", borderRadius: "12px", background: "#06151d" }}
              />
            ) : (
              <div className="empty-state">
                <Play size={22} />
                <h3>Preparing preview…</h3>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UnifiedAdminLivePage({ user }: { user: User | null }) {
  return <MeetAdminPanel user={user} />;
}

function MeetAdminPanel({ user }: { user: User | null }) {
  const notifications = useNotifications();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (user?.role === "admin")
      api<Course[]>("/admin/courses")
        .then(setCourses)
        .catch((cause) => setMessage((cause as Error).message));
  }, [user]);

  if (!user || user.role !== "admin") return null;
  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/live-classes", {
        method: "POST",
        body: JSON.stringify({
          course_id: Number(courseId),
          title,
          description,
          scheduled_at: new Date(scheduledAt).toISOString(),
        }),
      });
      setTitle("");
      setDescription("");
      setScheduledAt("");
      setMessage(
        "Google Meet class created. Click Start class below to create its protected meeting space.",
      );
      notifications.showToast({ kind: "success", title: "Live class created", message: "The protected Google Meet class is ready." });
    } catch (cause) {
      setMessage((cause as Error).message);
      notifications.showToast({ kind: "error", title: "Live class creation failed", message: (cause as Error).message || "Unable to create the live class." });
    }
  };
  return (
    <div className="container admin-page youtube-admin-page">
      <div className="admin-head">
        <div>
          <span className="eyebrow">GOOGLE MEET ADMIN CONTROL</span>
          <h1>Host a class.</h1>
          <p>
            Create a protected classroom, open Meet with the organizer account,
            and let Google save the recording to Drive.
          </p>
        </div>
        <span className="admin-badge">
          <Radio size={17} />
          Google Meet
        </span>
      </div>
      {message && <div className="notice">{message}</div>}
      <section className="panel">
        <form className="material-form youtube-create-form" onSubmit={create}>
          <label>
            Course
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              required
            >
              <option value="">Choose a course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Class title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Week 1 teaching aptitude"
              required
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            Scheduled time
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              required
            />
          </label>
          <button className="button button-lime" disabled={!courseId}>
            Create Google Meet class <Radio size={15} />
          </button>
        </form>
      </section>
      <section className="material-library">
        <span className="eyebrow">CLASSROOMS</span>
        <AdminLiveDashboard />
      </section>
    </div>
  );
}

export default App;
