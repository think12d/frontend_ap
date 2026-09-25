import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type ToastKind = "success" | "error" | "warning" | "info" | "loading";

type ToastItem = {
  id: number;
  kind: ToastKind;
  title: string;
  message: string;
  duration?: number;
};

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

type NotificationContextValue = {
  showToast: (toast: Omit<ToastItem, "id">) => void;
  confirmAction: (request: Omit<ConfirmRequest, "onConfirm"> & { onConfirm: () => void | Promise<void> }) => Promise<boolean>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    return {
      showToast: () => undefined,
      confirmAction: async () => true,
    } satisfies NotificationContextValue;
  }
  return context;
}

/**
 * One shared stylesheet for the toast viewport + confirm dialog.
 * Rendered once by NotificationProvider so real CSS (with media queries
 * and safe-area insets) can drive the mobile vs. laptop layouts, instead
 * of fixed inline pixel values.
 */
function NotificationStyles() {
  return (
    <style>{`
      .toast-viewport {
        position: fixed;
        z-index: 1100;
        display: flex;
        flex-direction: column;
        pointer-events: none;
        /* Laptop / desktop default: compact stack, top-right */
        top: 16px;
        right: 16px;
        gap: 12px;
        width: min(380px, calc(100vw - 32px));
      }

      .toast-item {
        pointer-events: auto;
        display: flex;
        gap: 12px;
        align-items: flex-start;
        background: rgba(15, 23, 42, 0.96);
        border: 1px solid var(--toast-accent-22, rgba(148,163,184,0.2));
        border-left: 4px solid var(--toast-accent, #38bdf8);
        border-radius: 14px;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.28);
        padding: 14px 16px;
        color: #e2e8f0;
        animation: toast-in 180ms ease-out;
      }

      .toast-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        margin-top: 6px;
        background: var(--toast-accent, #38bdf8);
        box-shadow: 0 0 18px var(--toast-accent, #38bdf8);
        flex-shrink: 0;
      }

      .toast-title {
        font-weight: 700;
        font-size: 14px;
        line-height: 1.35;
        margin-bottom: 4px;
      }

      .toast-message {
        font-size: 13px;
        color: #cbd5e1;
        line-height: 1.5;
        word-break: break-word;
      }

      .confirm-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.68);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1200;
        padding: 20px;
      }

      .confirm-dialog {
        width: min(440px, calc(100vw - 32px));
        background: #0f172a;
        border: 1px solid rgba(148,163,184,0.25);
        border-radius: 18px;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.5);
        padding: 24px;
        color: #e2e8f0;
      }

      .confirm-title {
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 10px;
      }

      .confirm-message {
        font-size: 14px;
        color: #cbd5e1;
        line-height: 1.6;
      }

      .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 24px;
      }

      .confirm-actions .button {
        min-height: 40px;
        padding-left: 18px;
        padding-right: 18px;
      }

      @keyframes toast-in {
        from { opacity: 0; transform: translateY(-8px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @keyframes toast-in-mobile {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* ---------- Mobile (phones) ---------- */
      @media (max-width: 640px) {
        .toast-viewport {
          top: auto;
          right: 0;
          left: 0;
          bottom: 0;
          width: 100%;
          gap: 10px;
          padding: 10px max(12px, env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px));
          box-sizing: border-box;
        }

        .toast-item {
          border-radius: 16px;
          padding: 14px 16px;
          animation-name: toast-in-mobile;
        }

        .toast-title {
          font-size: 15px;
        }

        .toast-message {
          font-size: 13.5px;
        }

        /* Bottom-sheet confirm dialog on small screens: easier to reach with a thumb */
        .confirm-overlay {
          align-items: flex-end;
          padding: 0;
        }

        .confirm-dialog {
          width: 100%;
          max-width: none;
          border-radius: 20px 20px 0 0;
          padding: 20px 18px calc(18px + env(safe-area-inset-bottom, 0px));
        }

        .confirm-actions {
          flex-direction: column-reverse;
          gap: 8px;
        }

        .confirm-actions .button {
          width: 100%;
        }
      }

      /* ---------- Small phones ---------- */
      @media (max-width: 380px) {
        .toast-title { font-size: 14px; }
        .toast-message { font-size: 13px; }
        .confirm-title { font-size: 16px; }
      }

      /* ---------- Laptop / desktop ---------- */
      @media (min-width: 1024px) {
        .toast-viewport {
          top: 20px;
          right: 20px;
          width: min(400px, calc(100vw - 40px));
          gap: 14px;
        }

        .toast-item {
          padding: 16px 18px;
        }
      }

      /* ---------- Large / ultra-wide desktop ---------- */
      @media (min-width: 1600px) {
        .toast-viewport {
          top: 24px;
          right: 24px;
          width: 420px;
        }
      }
    `}</style>
  );
}

const ACCENTS: Record<ToastKind, string> = {
  success: "#22c55e",
  error: "#ef4444",
  warning: "#f59e0b",
  loading: "#8b5cf6",
  info: "#38bdf8",
};

function ToastViewport({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => {
        const accent = ACCENTS[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className="toast-item"
            style={
              {
                "--toast-accent": accent,
                "--toast-accent-22": `${accent}22`,
              } as React.CSSProperties
            }
          >
            <div className="toast-dot" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="toast-title">{toast.title}</div>
              <div className="toast-message">{toast.message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConfirmDialog({
  request,
  onClose,
  onConfirmStart,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
  onConfirmStart: () => void;
}) {
  if (!request) return null;
  return (
    <div role="dialog" aria-modal="true" className="confirm-overlay" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="confirm-dialog">
        <div className="confirm-title">{request.title}</div>
        <div className="confirm-message">{request.message}</div>
        <div className="confirm-actions">
          <button className="button button-outline" type="button" onClick={onClose}>
            {request.cancelLabel || "Cancel"}
          </button>
          <button
            className={`button ${request.destructive ? "button-danger" : "button-dark"}`}
            type="button"
            onClick={async () => {
              onConfirmStart();
              await request.onConfirm();
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<(() => void) | null>(null);

  const showToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    const nextToast: ToastItem = { ...toast, id, duration: toast.duration ?? 3200 };
    setToasts((current) => [...current, nextToast]);
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, toast.duration ?? 3200),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts]);

  const confirmAction = useCallback(
    (request: Omit<ConfirmRequest, "onConfirm"> & { onConfirm: () => void | Promise<void> }) =>
      new Promise<boolean>((resolve) => {
        setConfirmCancel(() => () => resolve(false));
        setConfirmRequest({
          ...request,
          onConfirm: async () => {
            try {
              await request.onConfirm();
              resolve(true);
            } catch (cause) {
              showToast({
                kind: "error",
                title: "Action failed",
                message: (cause as Error).message || "Unable to complete that action.",
              });
              resolve(false);
            }
          },
        });
      }),
    [showToast],
  );

  const closeConfirm = useCallback(() => {
    confirmCancel?.();
    setConfirmCancel(null);
    setConfirmRequest(null);
  }, [confirmCancel]);

  const startConfirm = useCallback(() => {
    setConfirmCancel(null);
    setConfirmRequest(null);
  }, []);

  return (
    <NotificationContext.Provider value={{ showToast, confirmAction }}>
      <NotificationStyles />
      {children}
      <ToastViewport toasts={toasts} />
      <ConfirmDialog
        request={confirmRequest}
        onClose={closeConfirm}
        onConfirmStart={startConfirm}
      />
    </NotificationContext.Provider>
  );
}
