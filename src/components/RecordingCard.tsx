import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Film,
  HardDrive,
  LockKeyhole,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { api, apiBlob } from "../api";
import type { Course, LiveClass, User } from "../types";
import { useNotifications } from "../notifications";

/**
 * Drop-in module for the Admin "Recorded Videos" screen.
 *
 * Talks to the SAME existing endpoints your app already calls — nothing
 * about the Drive sync, matching engine, or data model changes here:
 *   GET   /admin/recorded-videos
 *   GET   /admin/recorded-videos/summary
 *   POST  /admin/recorded-videos/sync
 *   PATCH /admin/recorded-videos/{id}/assign          body: { course_id, live_class_id? }
 *   GET   /admin/recorded-videos/{id}/preview
 *   GET   /live-classes
 *   GET   /admin/courses
 *
 * Usage (in App.tsx):
 *   import AdminRecordedVideosPage from "./components/AdminRecordedVideosPage";
 *   <Route path="/admin/recorded-videos" element={<AdminRecordedVideosPage user={user} />} />
 *
 * Assignment rule: Course is always required. Live Class is ALWAYS optional —
 * whether or not the selected course has live classes, the admin can leave it
 * unset to save the recording as a prerecorded course video.
 */

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
  course_id?: number | null;
  live_class_title?: string | null;
  course_title?: string | null;
  suggested_course_id?: number | null;
  suggested_course_title?: string | null;
  status: string;
  matching_source?: string | null;
  match_confidence?: string | null;
  available?: boolean;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type RecordedVideosSummary = { total: number; assigned: number; unassigned: number };

function isAssigned(record: AdminRecordedVideo): boolean {
  return record.status === "ASSIGNED" && Boolean(record.live_class_id || record.course_id);
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isAudioRecording(mimeType?: string | null, fileName?: string | null): boolean {
  const normalizedMime = (mimeType || "").toLowerCase();
  if (normalizedMime.startsWith("audio/")) return true;
  if (normalizedMime.startsWith("video/")) return false;
  return /\.mp3$/i.test(fileName || "");
}

export function AdminRecordedVideosPage({ user }: { user: User | null }) {
  const notifications = useNotifications();
  const [records, setRecords] = useState<AdminRecordedVideo[]>([]);
  const [liveClasses, setLiveClasses] = useState<LiveClass[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [summary, setSummary] = useState<RecordedVideosSummary>({ total: 0, assigned: 0, unassigned: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [tab, setTab] = useState<"all" | "assigned" | "unassigned">("all");
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [pendingCourseByRecord, setPendingCourseByRecord] = useState<Record<number, string>>({});
  const [pendingClassByRecord, setPendingClassByRecord] = useState<Record<number, string>>({});
  const [editingAssignmentByRecord, setEditingAssignmentByRecord] = useState<Record<number, boolean>>({});
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [previewItem, setPreviewItem] = useState<AdminRecordedVideo | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [securingDriveAccess, setSecuringDriveAccess] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pageSize = 10;

  const load = async () => {
    setLoading(true);
    try {
      const [items, stats, classes, allCourses] = await Promise.all([
        api<AdminRecordedVideo[]>("/admin/recorded-videos"),
        api<RecordedVideosSummary>("/admin/recorded-videos/summary"),
        api<LiveClass[]>("/live-classes"),
        api<Course[]>("/admin/courses"),
      ]);
      const uniqueItems = Array.from(
        new Map(items.map((item) => [item.drive_file_id, item])).values(),
      );
      const suggestionResponse = uniqueItems.length
        ? await api<{
            suggestions: {
              id: number;
              course_id: number | null;
              course_title: string | null;
            }[];
          }>("/admin/recorded-videos/course-suggestions", {
            method: "POST",
            body: JSON.stringify({
              files: uniqueItems.slice(0, 500).map(({ id, file_name }) => ({ id, file_name })),
            }),
          }).catch(() => ({ suggestions: [] }))
        : { suggestions: [] };
      const suggestionsById = new Map(
        suggestionResponse.suggestions.map((item) => [item.id, item]),
      );
      setRecords(uniqueItems.map((item) => {
        const suggestion = suggestionsById.get(item.id);
        return {
          ...item,
          suggested_course_id: suggestion?.course_id ?? null,
          suggested_course_title: suggestion?.course_title ?? null,
        };
      }));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    setPage(1);
  }, [tab, search, sortBy, courseFilter]);

  const courseTitleById = useMemo(() => {
    const map = new Map<number, string>();
    for (const course of courses) map.set(course.id, course.title);
    return map;
  }, [courses]);

  const liveClassById = useMemo(() => {
    const map = new Map<number, LiveClass>();
    for (const item of liveClasses) map.set(item.id, item);
    return map;
  }, [liveClasses]);

  const enrichedRecords = useMemo(() => {
    return records.map((record) => {
      const liveClass = record.live_class_id ? liveClassById.get(record.live_class_id) || null : null;
      const courseTitle = record.course_id
        ? courseTitleById.get(record.course_id) || ""
        : liveClass
          ? courseTitleById.get(liveClass.course_id) || ""
          : "";
      return {
        ...record,
        liveClassTitle: record.live_class_title || liveClass?.title || (record.course_id && !record.live_class_id ? "Prerecorded video" : ""),
        courseTitle,
      };
    });
  }, [records, liveClassById, courseTitleById]);

  const visibleRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = enrichedRecords.filter((record) => {
      const matchesTab =
        tab === "all" || (tab === "assigned" ? isAssigned(record) : !isAssigned(record));
      const matchesSearch =
        !query ||
        `${record.file_name} ${record.courseTitle} ${record.suggested_course_title || ""} ${record.liveClassTitle}`.toLowerCase().includes(query);
      const recordCourseId = record.course_id ?? (record.live_class_id ? liveClassById.get(record.live_class_id)?.course_id : undefined);
      const matchesCourse = !courseFilter || String(recordCourseId) === courseFilter;
      return matchesTab && matchesSearch && matchesCourse;
    });
    return [...filtered].sort((left, right) => {
      if (sortBy === "name") return (left.file_name || "").localeCompare(right.file_name || "");
      const leftDate = left.drive_created_at ? Date.parse(left.drive_created_at) : new Date(left.created_at || 0).getTime();
      const rightDate = right.drive_created_at ? Date.parse(right.drive_created_at) : new Date(right.created_at || 0).getTime();
      return sortBy === "oldest" ? leftDate - rightDate : rightDate - leftDate;
    });
  }, [courseFilter, enrichedRecords, liveClassById, search, sortBy, tab]);

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
      const result = await api<{ checked: number; assigned: number; unassigned: number; message: string }>(
        "/admin/recorded-videos/sync",
        { method: "POST" },
      );
      setNotice(`${result.message} — ${result.checked} checked, ${result.assigned} matched, ${result.unassigned} need review.`);
      notifications.showToast({
        kind: "success",
        title: "Recordings synced",
        message: `${result.checked} videos checked, ${result.assigned} matched.`,
      });
      await load();
    } catch (cause) {
      const messageText = (cause as Error).message || "Unable to sync recordings right now.";
      setError(messageText);
      notifications.showToast({ kind: "error", title: "Sync failed", message: messageText });
    } finally {
      setSyncing(false);
    }
  };

  const lockDriveAccess = async () => {
    const confirmed = window.confirm(
      "Remove direct Google Drive sharing from files and folders in the recorded-videos folder? Inherited access from a parent folder or shared drive must be removed there.",
    );
    if (!confirmed) return;

    setSecuringDriveAccess(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ scanned: number; revoked: number; inherited: number; failed: number }>(
        "/admin/recorded-videos/lock-drive-access",
        { method: "POST" },
      );
      const remaining = result.inherited + result.failed;
      const message = `Checked ${result.scanned} Drive items and removed ${result.revoked} direct shares.${remaining ? ` ${result.inherited} inherited permissions and ${result.failed} failures still need attention in Google Drive.` : " No remaining permissions were reported."}`;
      setNotice(message);
      notifications.showToast({
        kind: remaining ? "error" : "success",
        title: remaining ? "Drive access needs review" : "Drive sharing locked",
        message,
      });
    } catch (cause) {
      const message = (cause as Error).message || "Unable to secure Drive sharing.";
      setError(message);
      notifications.showToast({ kind: "error", title: "Drive security action failed", message });
    } finally {
      setSecuringDriveAccess(false);
    }
  };

  const assignRecording = async (recordId: number, courseId: string, liveClassId: string) => {
    const selectedCourseId = Number(courseId);
    const selectedLiveClassId = liveClassId ? Number(liveClassId) : null;
    if (!selectedCourseId) {
      setError("Choose a course before assigning this recording.");
      return;
    }
    setAssigningId(recordId);
    setError("");
    setNotice("");
    try {
      await api(`/admin/recorded-videos/${recordId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ course_id: selectedCourseId, live_class_id: selectedLiveClassId }),
      });
      const assignmentMessage = selectedLiveClassId
        ? "Linked to the selected live class."
        : "Assigned as a prerecorded course video.";
      setNotice(`Recording assigned. ${assignmentMessage}`);
      notifications.showToast({ kind: "success", title: "Recording assigned", message: assignmentMessage });
      await load();
      setEditingAssignmentByRecord((current) => ({ ...current, [recordId]: false }));
    } catch (cause) {
      const messageText = (cause as Error).message || "Unable to assign this recording.";
      setError(messageText);
      notifications.showToast({ kind: "error", title: "Assignment failed", message: messageText });
    } finally {
      setAssigningId(null);
    }
  };

  const uploadRecording = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const acceptedMimeTypes: Record<string, string[]> = {
      webm: ["video/webm"],
      mp4: ["video/mp4"],
      mp3: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
    };
    if (!extension || !acceptedMimeTypes[extension]) {
      setError("Choose a WEBM, MP4, or MP3 recording.");
      return;
    }
    if (file.type && file.type !== "application/octet-stream" && !acceptedMimeTypes[extension].includes(file.type)) {
      setError("The selected file type does not match its extension.");
      return;
    }
    if (file.size > 1024 * 1024 * 1024) {
      setError("Recordings must be no larger than 1 GB.");
      return;
    }

    setUploading(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api<AdminRecordedVideo>("/admin/recorded-videos/upload", {
        method: "POST",
        body: form,
      });
      setNotice(`${result.file_name} uploaded and added as unassigned.`);
      notifications.showToast({
        kind: "success",
        title: "Recording uploaded",
        message: "The recording is ready for course / Live Class assignment.",
      });
      await load();
    } catch (cause) {
      const message = (cause as Error).message || "Unable to upload this recording.";
      setError(message);
      notifications.showToast({ kind: "error", title: "Upload failed", message });
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const openPreview = async (record: AdminRecordedVideo) => {
    setPreviewBusy(true);
    setPreviewUrl("");
    setPreviewItem(record);
    try {
      const media = await apiBlob(`/admin/recorded-videos/${record.id}/preview`);
      setPreviewUrl(URL.createObjectURL(media));
    } catch (cause) {
      setError((cause as Error).message || "Unable to load the preview right now.");
      setPreviewItem(null);
    } finally {
      setPreviewBusy(false);
    }
  };

  const closePreview = () => {
    setPreviewItem(null);
    setPreviewUrl("");
  };

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);

  if (!user || user.role !== "admin") {
    return (
      <div className="rv2-root">
        <style>{RV2_STYLES}</style>
        <div className="rv2-guard">
          <ShieldCheck size={24} />
          <p>Admin access only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rv2-root">
      <style>{RV2_STYLES}</style>

      <header className="rv2-header">
        <div>
          <span className="rv2-eyebrow">Recorded Videos</span>
          <h1>Recorded videos</h1>
          <p className="rv2-subtitle">Live Class recordings are matched automatically by Drive metadata and timing; prerecorded videos only need a course — Live Class is always optional.</p>
        </div>
        <div className="rv2-header-actions">
          <input
            ref={uploadInputRef}
            type="file"
            accept=".webm,.mp4,.mp3,video/webm,video/mp4,audio/mpeg"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void uploadRecording(file);
            }}
          />
          <button
            className="rv2-btn rv2-btn-ghost"
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={16} /> {uploading ? "Uploading…" : "Upload recording"}
          </button>
          <button className="rv2-btn rv2-btn-primary" type="button" onClick={() => void syncNow()} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? "rv2-spin" : ""} />
            {syncing ? "Syncing…" : "Sync Google Drive"}
          </button>
          <button
            className="rv2-btn rv2-btn-ghost"
            type="button"
            onClick={() => void lockDriveAccess()}
            disabled={securingDriveAccess || syncing || uploading}
          >
            <LockKeyhole size={16} /> {securingDriveAccess ? "Securing Drive…" : "Lock Drive sharing"}
          </button>
        </div>
      </header>

      {notice && (
        <div className="rv2-banner rv2-banner-success">
          <Check size={16} />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="rv2-banner rv2-banner-error">
          <span>{error}</span>
        </div>
      )}

      <div className="rv2-stats">
        <div className="rv2-stat">
          <span className="rv2-stat-label">Total videos</span>
          <span className="rv2-stat-value">{summary.total || records.length}</span>
        </div>
        <div className="rv2-stat rv2-stat-success">
          <span className="rv2-stat-label">Assigned</span>
          <span className="rv2-stat-value">{summary.assigned || records.filter(isAssigned).length}</span>
        </div>
        <div className="rv2-stat rv2-stat-warning">
          <span className="rv2-stat-label">Unassigned</span>
          <span className="rv2-stat-value">{summary.unassigned || records.filter((item) => !isAssigned(item)).length}</span>
        </div>
      </div>

      <div className="rv2-toolbar">
        <div className="rv2-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by file, course or live class…"
          />
        </div>
        <div className="rv2-tabs">
          {(["all", "assigned", "unassigned"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`rv2-tab ${tab === key ? "is-active" : ""}`}
              onClick={() => setTab(key)}
            >
              {key === "all" ? "All" : key === "assigned" ? "Assigned" : "Unassigned"}
            </button>
          ))}
        </div>
        <select className="rv2-sort" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
        </select>
        <select
          className="rv2-sort"
          aria-label="Filter by course"
          value={courseFilter}
          onChange={(event) => setCourseFilter(event.target.value)}
        >
          <option value="">All courses</option>
          {courses.map((course) => <option key={course.id} value={String(course.id)}>{course.title}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="rv2-loading">
          <RefreshCw size={18} className="rv2-spin" />
          <span>Loading recordings…</span>
        </div>
      ) : paginatedRecords.length === 0 ? (
        <div className="rv2-empty">
          <Film size={22} />
          <h3>No recordings here yet.</h3>
          <p>Run a sync to pull the latest recordings from Google Drive.</p>
        </div>
      ) : (
        <div className="rv2-list">
          {paginatedRecords.map((record, index) => {
            const assigned = isAssigned(record);
            const pendingCourse = pendingCourseByRecord[record.id] ?? (record.suggested_course_id ? String(record.suggested_course_id) : "");
            const pendingClass = pendingClassByRecord[record.id] ?? "";
            const availableLiveClasses = liveClasses.filter((item) => String(item.course_id) === pendingCourse);
            return (
              <article
                className={`rv2-card ${assigned ? "rv2-card-assigned" : "rv2-card-unassigned"}`}
                key={record.id}
                style={{ animationDelay: `${(index % pageSize) * 35}ms` }}
              >
                <div className="rv2-card-top">
                  <div className="rv2-card-title">
                    <Film size={16} />
                    <span title={record.file_name}>{record.file_name}</span>
                  </div>
                  <span className={`rv2-pill ${assigned ? "rv2-pill-success" : "rv2-pill-warning"}`}>
                    {assigned ? "Assigned" : "Unassigned"}
                  </span>
                </div>

                <div className="rv2-meta-row">
                  <span className="rv2-meta">
                    <HardDrive size={13} /> {formatBytes(record.file_size)}
                  </span>
                  <span className="rv2-meta">
                    <Clock3 size={13} /> {formatDuration(record.duration_seconds)}
                  </span>
                  <span className="rv2-meta">Uploaded {formatWhen(record.drive_created_at || record.created_at)}</span>
                  {record.matching_source && (
                    <span className="rv2-meta rv2-meta-tag">
                      <Sparkles size={13} /> {record.matching_source === "AUTO" ? "Auto-matched" : "Manually assigned"}
                      {record.match_confidence ? ` · ${record.match_confidence}` : ""}
                    </span>
                  )}
                </div>

                {record.last_error && <div className="rv2-warn-line">{record.last_error}</div>}

                {assigned && !editingAssignmentByRecord[record.id] ? (
                  <div className="rv2-assigned-info">
                    <div>
                      <span className="rv2-info-label">Course</span>
                      <span className="rv2-info-value">{record.courseTitle || "Course unavailable"}</span>
                    </div>
                    <div>
                      <span className="rv2-info-label">{record.live_class_id ? "Live class" : "Type"}</span>
                      <span className="rv2-info-value">{record.live_class_id ? record.liveClassTitle || "—" : "Prerecorded video"}</span>
                    </div>
                    <button
                      className="rv2-btn rv2-btn-ghost"
                      type="button"
                      onClick={() => {
                        const currentLiveClass = record.live_class_id
                          ? liveClassById.get(record.live_class_id)
                          : null;
                        const courseId = record.course_id ?? currentLiveClass?.course_id;
                        setPendingCourseByRecord((current) => ({
                          ...current,
                          [record.id]: courseId ? String(courseId) : "",
                        }));
                        setPendingClassByRecord((current) => ({
                          ...current,
                          [record.id]: record.live_class_id ? String(record.live_class_id) : "",
                        }));
                        setEditingAssignmentByRecord((current) => ({ ...current, [record.id]: true }));
                      }}
                    >
                      Edit assignment
                    </button>
                    <button className="rv2-btn rv2-btn-ghost" type="button" onClick={() => void openPreview(record)}>
                      <Play size={14} /> Preview
                    </button>
                  </div>
                ) : (
                  <div className="rv2-assign-row">
                    <select
                      aria-label={`Choose course for ${record.file_name}`}
                      value={pendingCourse}
                      onChange={(event) => {
                        setPendingCourseByRecord((current) => ({ ...current, [record.id]: event.target.value }));
                        setPendingClassByRecord((current) => ({ ...current, [record.id]: "" }));
                      }}
                    >
                      <option value="">Select a course…</option>
                      {courses.map((course) => (
                        <option key={course.id} value={String(course.id)}>{course.title}</option>
                      ))}
                    </select>

                    {pendingCourse && (
                      <div className="rv2-livewrap">
                        {availableLiveClasses.length > 0 ? (
                          <select
                            aria-label={`Choose Live Class for ${record.file_name} (optional)`}
                            value={pendingClass}
                            onChange={(event) =>
                              setPendingClassByRecord((current) => ({ ...current, [record.id]: event.target.value }))
                            }
                          >
                            <option value="">No Live Class — Prerecorded Video</option>
                            {availableLiveClasses.map((item) => (
                              <option key={item.id} value={String(item.id)}>{item.title}</option>
                            ))}
                          </select>
                        ) : (
                          <div className="rv2-info-value" role="status">No Live Class — Prerecorded Video</div>
                        )}
                        <small className="rv2-optional-hint">
                          Live Class is optional — leave it unselected to save this as a prerecorded course video.
                        </small>
                      </div>
                    )}

                    <button
                      className="rv2-btn rv2-btn-primary"
                      type="button"
                      disabled={assigningId === record.id || !pendingCourse}
                      onClick={() => void assignRecording(record.id, pendingCourse, pendingClass)}
                    >
                      {assigningId === record.id ? "Saving…" : editingAssignmentByRecord[record.id] ? "Save assignment" : "Assign recording"}
                    </button>
                    {editingAssignmentByRecord[record.id] && (
                      <button
                        className="rv2-btn rv2-btn-ghost"
                        type="button"
                        disabled={assigningId === record.id}
                        onClick={() => setEditingAssignmentByRecord((current) => ({ ...current, [record.id]: false }))}
                      >
                        Cancel
                      </button>
                    )}
                    <button className="rv2-btn rv2-btn-ghost" type="button" onClick={() => void openPreview(record)}>
                      <Play size={14} /> Preview
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="rv2-pagination">
          <button
            type="button"
            className="rv2-btn rv2-btn-ghost"
            disabled={safePage === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft size={14} /> Prev
          </button>
          {pageNumbers.map((number) => (
            <button
              key={number}
              type="button"
              className={`rv2-page ${safePage === number ? "is-active" : ""}`}
              onClick={() => setPage(number)}
            >
              {number}
            </button>
          ))}
          <button
            type="button"
            className="rv2-btn rv2-btn-ghost"
            disabled={safePage === totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}

      {previewItem && (
        <div className="rv2-modal-backdrop" onClick={closePreview}>
          <div className="rv2-modal" onClick={(event) => event.stopPropagation()}>
            <button className="rv2-modal-close" type="button" onClick={closePreview} aria-label="Close preview">
              <X size={16} />
            </button>
            <h3>{previewItem.file_name}</h3>
            {previewUrl ? (
              isAudioRecording(previewItem.mime_type, previewItem.file_name) ? (
                <audio src={previewUrl} controls autoPlay />
              ) : (
                <video src={previewUrl} controls playsInline autoPlay />
              )
            ) : previewBusy ? (
              <div className="rv2-modal-loading">
                <RefreshCw size={18} className="rv2-spin" />
                <span>Preparing preview…</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

type RecordingCardData = {
  liveClassId?: number;
  courseId?: number;
  hideWhenEmpty?: boolean;
  title: string;
  topic: string;
  date?: string;
  paymentUrl: string;
};

type LearnerRecording = {
  id: string;
  name: string;
  mime_type: string;
  course_id: number;
  live_class_id?: number | null;
  meeting_name?: string;
  display_name?: string;
  recorded_at?: string | null;
  play_url: string;
};

export default function RecordingCard({ data }: { data: RecordingCardData }) {
  const [recordings, setRecordings] = useState<LearnerRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loadingMediaId, setLoadingMediaId] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const [driveAccessUrls, setDriveAccessUrls] = useState<Record<string, string>>({});
  const [driveBusyId, setDriveBusyId] = useState<string | null>(null);
  const mediaUrlByIdRef = useRef<Record<string, string>>({});

  useEffect(() => () => {
    Object.values(mediaUrlByIdRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const loadRecording = async (recording: LearnerRecording) => {
    if (mediaUrls[recording.id]) return;
    setLoadingMediaId(recording.id);
    setPlaybackError("");
    try {
      const media = await apiBlob(recording.play_url);
      const url = URL.createObjectURL(media);
      mediaUrlByIdRef.current[recording.id] = url;
      setMediaUrls((current) => ({ ...current, [recording.id]: url }));
    } catch (cause) {
      setPlaybackError((cause as Error).message || "Unable to load this recording.");
    } finally {
      setLoadingMediaId(null);
    }
  };

  const openInDrive = async (recording: LearnerRecording) => {
    const driveWindow = window.open("about:blank", "_blank");
    if (driveWindow) driveWindow.opener = null;
    setDriveBusyId(recording.id);
    setPlaybackError("");
    try {
      const result = await api<{ url: string }>(
        `/library/recorded-videos/${encodeURIComponent(recording.id)}/drive-view`,
        { method: "POST" },
      );
      setDriveAccessUrls((current) => ({ ...current, [recording.id]: result.url }));
      if (driveWindow) driveWindow.location.replace(result.url);
    } catch (cause) {
      driveWindow?.close();
      setPlaybackError((cause as Error).message || "Unable to grant Drive access.");
    } finally {
      setDriveBusyId(null);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<{ items: LearnerRecording[]; premium_required?: boolean }>('/library/recorded-videos')
      .then((library) => {
        if (!active) return;
        if (library.premium_required) {
          setError('Course access is required to play this recording.');
          return;
        }

        const matching = (library.items || []).filter((item) =>
          data.liveClassId !== undefined
            ? item.live_class_id === data.liveClassId
            : (item.live_class_id === null || item.live_class_id === undefined) && item.course_id === data.courseId,
        );

        setRecordings(matching);
        if (matching.length === 0 && !data.hideWhenEmpty) setError('Recording is not available yet.');
      })
      .catch((cause) => {
        if (active) setError((cause as Error).message || 'Unable to load this recording.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [data.title, data.topic, data.liveClassId, data.courseId, data.hideWhenEmpty]);

  if (data.hideWhenEmpty && !loading && !error && recordings.length === 0) return null;

  return (
    <article className="recording-card">
      <div className="recording-card-copy">
        <span className="eyebrow">CLASS RECORDING</span>
        <h3>{data.title}</h3>
        <p>{data.topic}</p>
        {data.date && <small>{new Date(data.date).toLocaleDateString("en-IN")}</small>}
      </div>
      {loading ? (
        <p className="muted">Loading recording…</p>
      ) : recordings.length ? (
        <div className="recording-card-media-list">
          {recordings.map((recording) => {
            const isAudio = isAudioRecording(recording.mime_type, recording.name);
            const mediaUrl = mediaUrls[recording.id];
            return (
              <div key={`${recording.id}-${recording.play_url}`} className="recording-card-media-item">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span>{recording.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => void openInDrive(recording)}
                      disabled={driveBusyId === recording.id}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 10px", border: "1px solid currentColor", borderRadius: 6, background: "transparent", cursor: driveBusyId === recording.id ? "wait" : "pointer" }}
                    >
                      <ExternalLink size={14} />
                      {driveBusyId === recording.id ? "Granting access…" : "Open in Drive"}
                    </button>
                    {driveAccessUrls[recording.id] && !driveBusyId && (
                      <a href={driveAccessUrls[recording.id]} target="_blank" rel="noopener noreferrer">Open again</a>
                    )}
                  </div>
                </div>
                {mediaUrl ? (isAudio ? (
                  <audio controls preload="metadata" src={mediaUrl}>
                    Your browser does not support audio playback.
                  </audio>
                ) : (
                  <video controls playsInline preload="metadata" src={mediaUrl}>
                    Your browser does not support video playback.
                  </video>
                )) : (
                  <button type="button" onClick={() => void loadRecording(recording)} disabled={loadingMediaId === recording.id}>
                    {loadingMediaId === recording.id ? "Loading recording…" : "Play recording"}
                  </button>
                )}
              </div>
            );
          })}
          {playbackError && <div className="recording-card-error" role="alert">{playbackError}</div>}
        </div>
      ) : (
        <div className="recording-card-error" role="status">
          <span>{error}</span>
          {(error.includes("402") || error.toLowerCase().includes("access")) && (
            <a href={data.paymentUrl}>View course access</a>
          )}
        </div>
      )}
    </article>
  );
}


const RV2_STYLES = `
.rv2-root {
  --rv2-ink: #171921;
  --rv2-ink-soft: #4b4f5e;
  --rv2-paper: #f2f3f7;
  --rv2-surface: #ffffff;
  --rv2-border: #e1e3ea;
  --rv2-border-strong: #c9cbd6;
  --rv2-teal: #0f6d5c;
  --rv2-teal-soft: #e3f2ee;
  --rv2-amber: #a8630e;
  --rv2-amber-soft: #faf0dd;
  --rv2-danger: #b3392c;
  --rv2-danger-soft: #fbeae7;
  --rv2-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  --rv2-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  --rv2-radius: 14px;
  font-family: var(--rv2-sans);
  color: var(--rv2-ink);
  background: var(--rv2-paper);
  padding: 22px clamp(14px, 4vw, 34px) 48px;
  border-radius: 18px;
  box-sizing: border-box;
}
.rv2-root * { box-sizing: border-box; }
 
.rv2-guard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  background: var(--rv2-surface);
  border: 1px solid var(--rv2-border);
  border-radius: var(--rv2-radius);
  color: var(--rv2-ink-soft);
}
 
/* ---------- header ---------- */
.rv2-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  flex-wrap: wrap;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--rv2-border-strong);
}
.rv2-header-copy { max-width: 62ch; }
.rv2-kicker {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--rv2-mono);
  font-size: 12px;
  color: var(--rv2-teal);
  letter-spacing: 0.01em;
}
.rv2-kicker-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--rv2-teal); }
.rv2-header h1 {
  margin: 8px 0 6px;
  font-size: clamp(23px, 2.6vw, 29px);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.rv2-subtitle { margin: 0; color: var(--rv2-ink-soft); font-size: 14px; line-height: 1.55; }
 
.rv2-header-actions { display: flex; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
 
/* ---------- buttons ---------- */
.rv2-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 9px;
  border: 1px solid transparent;
  font-size: 13.5px;
  font-weight: 600;
  padding: 10px 16px;
  min-height: 40px;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  white-space: nowrap;
}
.rv2-btn:focus-visible { outline: 2px solid var(--rv2-teal); outline-offset: 2px; }
.rv2-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.rv2-btn-solid { background: var(--rv2-ink); border-color: var(--rv2-ink); color: #fff; }
.rv2-btn-solid:hover:not(:disabled) { background: var(--rv2-teal); border-color: var(--rv2-teal); }
.rv2-btn-outline { background: var(--rv2-surface); border-color: var(--rv2-border-strong); color: var(--rv2-ink); }
.rv2-btn-outline:hover:not(:disabled) { border-color: var(--rv2-ink); }
.rv2-btn-quiet { background: transparent; border-color: transparent; color: var(--rv2-ink-soft); padding-left: 10px; padding-right: 10px; }
.rv2-btn-quiet:hover:not(:disabled) { color: var(--rv2-ink); background: var(--rv2-paper); }
.rv2-btn-sm { min-height: 32px; padding: 6px 12px; font-size: 12.5px; }
 
.rv2-spin { animation: rv2-spin 0.9s linear infinite; }
@keyframes rv2-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .rv2-spin { animation: none; } }
 
/* ---------- banners ---------- */
.rv2-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 11px 14px;
  border-radius: 10px;
  font-size: 13.5px;
  border: 1px solid transparent;
}
.rv2-banner-success { background: var(--rv2-teal-soft); color: var(--rv2-teal); border-color: #cbe6de; }
.rv2-banner-error { background: var(--rv2-danger-soft); color: var(--rv2-danger); border-color: #f1cec7; }
 
/* ---------- ticker stat strip ---------- */
.rv2-ticker {
  display: flex;
  align-items: center;
  gap: 22px;
  margin-top: 22px;
  padding: 16px 20px;
  background: var(--rv2-ink);
  border-radius: var(--rv2-radius);
  overflow-x: auto;
}
.rv2-ticker-item { display: flex; flex-direction: column; gap: 2px; white-space: nowrap; }
.rv2-ticker-item b { font-size: 22px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }
.rv2-ticker-item span { font-size: 12px; color: #9ba0b3; }
.rv2-ticker-good b { color: #6fd3b8; }
.rv2-ticker-warn b { color: #f0b467; }
.rv2-ticker-div { width: 1px; height: 30px; background: #33364433; flex-shrink: 0; }
 
/* ---------- toolbar ---------- */
.rv2-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
}
.rv2-search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--rv2-surface);
  border: 1px solid var(--rv2-border);
  border-radius: 9px;
  padding: 9px 12px;
  flex: 1 1 220px;
  min-width: 0;
  color: var(--rv2-ink-soft);
}
.rv2-search input { border: none; outline: none; flex: 1; font-size: 13.5px; background: transparent; color: var(--rv2-ink); min-width: 0; }
.rv2-tabs { display: flex; gap: 2px; background: var(--rv2-surface); border: 1px solid var(--rv2-border); border-radius: 9px; padding: 3px; }
.rv2-tab { border: none; background: transparent; padding: 7px 13px; border-radius: 7px; font-size: 13px; font-weight: 600; color: var(--rv2-ink-soft); cursor: pointer; transition: background 0.12s ease, color 0.12s ease; }
.rv2-tab.is-active { background: var(--rv2-ink); color: #fff; }
.rv2-sort { border: 1px solid var(--rv2-border); border-radius: 9px; padding: 9px 12px; font-size: 13px; background: var(--rv2-surface); color: var(--rv2-ink); }
 
/* ---------- loading / empty ---------- */
.rv2-loading, .rv2-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 50px 16px;
  color: var(--rv2-ink-soft);
  text-align: center;
  border: 1px dashed var(--rv2-border-strong);
  border-radius: var(--rv2-radius);
  margin-top: 18px;
}
.rv2-empty h3 { margin: 4px 0 0; color: var(--rv2-ink); font-size: 15px; }
.rv2-empty p { margin: 0; font-size: 13.5px; }
 
/* ---------- ledger rows ---------- */
.rv2-log {
  margin-top: 18px;
  background: var(--rv2-surface);
  border: 1px solid var(--rv2-border);
  border-radius: var(--rv2-radius);
  overflow: hidden;
}
.rv2-row {
  display: flex;
  border-bottom: 1px solid var(--rv2-border);
}
.rv2-row:last-child { border-bottom: none; }
.rv2-rail { width: 3px; flex-shrink: 0; }
.rv2-rail-good { background: var(--rv2-teal); }
.rv2-rail-warn { background: var(--rv2-amber); }
 
.rv2-row-body { flex: 1; padding: 15px 18px; min-width: 0; }
 
.rv2-row-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.rv2-row-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.rv2-row-icon { color: var(--rv2-ink-soft); flex-shrink: 0; }
.rv2-filename {
  font-family: var(--rv2-mono);
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
 
.rv2-status { font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 6px; white-space: nowrap; letter-spacing: 0.01em; }
.rv2-status-good { background: var(--rv2-teal-soft); color: var(--rv2-teal); }
.rv2-status-warn { background: var(--rv2-amber-soft); color: var(--rv2-amber); }
 
.rv2-tagrow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.rv2-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--rv2-mono);
  font-size: 11.5px;
  color: var(--rv2-ink-soft);
  background: var(--rv2-paper);
  border: 1px solid var(--rv2-border);
  border-radius: 6px;
  padding: 3px 8px;
}
.rv2-tag-quiet { color: var(--rv2-ink-soft); }
.rv2-tag-accent { color: var(--rv2-teal); border-color: #c9e5dc; background: var(--rv2-teal-soft); }
 
.rv2-warn-line { margin-top: 10px; font-size: 12.5px; color: var(--rv2-danger); }
 
.rv2-assigned-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--rv2-border);
}
.rv2-info-block { display: flex; flex-direction: column; gap: 2px; }
.rv2-info-label { font-size: 11px; color: var(--rv2-ink-soft); font-weight: 600; text-transform: none; }
.rv2-info-value { font-size: 13.5px; font-weight: 600; }
.rv2-row-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
 
/* ---------- assign form ---------- */
.rv2-assign-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--rv2-border);
}
.rv2-field { display: flex; flex-direction: column; gap: 5px; flex: 1 1 210px; min-width: 0; }
.rv2-field-label { font-size: 11.5px; font-weight: 600; color: var(--rv2-ink-soft); }
.rv2-field-label em { font-style: normal; font-weight: 500; color: #8b90a0; margin-left: 4px; }
.rv2-field select {
  width: 100%;
  border: 1px solid var(--rv2-border-strong);
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 13px;
  background: var(--rv2-surface);
  color: var(--rv2-ink);
}
.rv2-field select:focus-visible { outline: 2px solid var(--rv2-teal); outline-offset: 1px; }
.rv2-field-static {
  border: 1px dashed var(--rv2-border-strong);
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 13px;
  color: var(--rv2-ink-soft);
  background: var(--rv2-paper);
}
 
/* ---------- pagination ---------- */
.rv2-pagination { display: flex; justify-content: center; align-items: center; gap: 5px; margin-top: 24px; flex-wrap: wrap; }
.rv2-page { border: 1px solid var(--rv2-border); background: var(--rv2-surface); border-radius: 7px; min-width: 32px; height: 32px; font-size: 12.5px; font-weight: 600; color: var(--rv2-ink-soft); cursor: pointer; }
.rv2-page.is-active { background: var(--rv2-ink); border-color: var(--rv2-ink); color: #fff; }
 
/* ---------- preview modal ---------- */
.rv2-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 16, 23, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 60;
}
.rv2-modal {
  background: var(--rv2-surface);
  border-radius: 14px;
  padding: 20px;
  width: min(92vw, 820px);
  position: relative;
  box-shadow: 0 24px 60px rgba(10, 11, 16, 0.35);
}
.rv2-modal h3 { margin: 0 0 12px; font-size: 14px; font-family: var(--rv2-mono); font-weight: 500; padding-right: 30px; }
.rv2-modal video,
.rv2-modal audio { width: 100%; max-height: 65vh; border-radius: 10px; background: #0b0c14; display: block; }
.rv2-modal-close {
  position: absolute; top: 14px; right: 14px;
  border: none; background: var(--rv2-paper); border-radius: 999px;
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--rv2-ink-soft);
}
.rv2-modal-loading { display: flex; align-items: center; gap: 8px; padding: 40px 0; justify-content: center; color: var(--rv2-ink-soft); }
 
/* ---------- responsive ---------- */
@media (max-width: 900px) {
  .rv2-ticker { gap: 16px; }
}
 
@media (max-width: 720px) {
  .rv2-header { flex-direction: column; align-items: stretch; }
  .rv2-header-actions { width: 100%; }
  .rv2-header-actions .rv2-btn { flex: 1 1 auto; }
  .rv2-assigned-info { flex-direction: column; align-items: flex-start; gap: 10px; }
  .rv2-row-actions { margin-left: 0; }
  .rv2-row-top { flex-direction: column; align-items: flex-start; gap: 6px; }
}
 
@media (max-width: 560px) {
  .rv2-root { padding: 14px 12px 32px; border-radius: 14px; }
  .rv2-toolbar { flex-direction: column; align-items: stretch; }
  .rv2-tabs { justify-content: space-between; }
  .rv2-tab { flex: 1; text-align: center; }
  .rv2-sort { width: 100%; }
  .rv2-ticker { gap: 14px; padding: 14px; }
  .rv2-ticker-item b { font-size: 19px; }
  .rv2-assign-row { flex-direction: column; align-items: stretch; }
  .rv2-field { flex: 1 1 auto; }
  .rv2-row-body { padding: 13px 14px; }
  .rv2-modal { width: 96vw; padding: 14px; }
  .rv2-pagination { gap: 4px; }
  .rv2-page { min-width: 28px; height: 28px; font-size: 12px; }
}
 
@media (max-width: 380px) {
  .rv2-header h1 { font-size: 20px; }
  .rv2-ticker { flex-wrap: wrap; row-gap: 10px; }
  .rv2-filename { font-size: 12px; }
}
`;
 
