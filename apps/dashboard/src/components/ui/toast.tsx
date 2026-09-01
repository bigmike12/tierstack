"use client";

import { CheckCircle2, X, XCircle } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: "success" | "error" | "info";
  /** Milliseconds before it dismisses itself. Zero means it stays until closed. */
  duration?: number;
}

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: "success" | "error" | "info";
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>.");
  return ctx;
}

const DEFAULT_DURATION = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const duration = options.duration ?? DEFAULT_DURATION;
      setToasts((current) => [
        ...current,
        { id, title: options.title, description: options.description, variant: options.variant ?? "info" },
      ]);
      if (duration > 0) window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted
        ? createPortal(
            <div
              role="region"
              aria-label="Notifications"
              className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-end gap-2 p-4 sm:p-6"
            >
              {toasts.map((item) => (
                <div
                  key={item.id}
                  role="status"
                  aria-live="polite"
                  className={cn(
                    "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border bg-card p-3.5 text-card-foreground shadow-lg toast-enter",
                    item.variant === "success" && "border-success/30",
                    item.variant === "error" && "border-destructive/30",
                    item.variant === "info" && "border-border"
                  )}
                >
                  {item.variant === "success" ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  ) : item.variant === "error" ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{item.title}</p>
                    {item.description ? (
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(item.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Dismiss"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  );
}

/**
 * Fires a toast from a `useActionState` result — {error} or {message} — the
 * moment it changes, instead of rendering an inline banner in the form. Mount
 * once per form; it renders nothing itself.
 */
export function ActionToast({ state }: { state: { error?: string; message?: string } }) {
  const { toast } = useToast();
  React.useEffect(() => {
    if (state.error) toast({ title: state.error, variant: "error" });
    else if (state.message) toast({ title: state.message, variant: "success" });
    // Only the identity of `state` should retrigger this — useActionState
    // hands back a fresh object on every action result, including repeats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return null;
}
