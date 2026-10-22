import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "../cn";

interface ToastItem {
  id: number;
  message: string;
  tone: "good" | "bad" | "info";
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone: ToastItem["tone"], message: string) => {
      const id = Date.now() + Math.random();
      setItems((all) => [...all.slice(-3), { id, tone, message }]);
      setTimeout(() => remove(id), tone === "bad" ? 7000 : 4000);
    },
    [remove],
  );
  const value = useMemo<ToastApi>(
    () => ({
      success: (m) => push("good", m),
      error: (m) => push("bad", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-0 bottom-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-ui border bg-surface px-4 py-3 text-sm shadow-lg",
              t.tone === "bad" ? "border-bad/40" : "border-line",
            )}
          >
            {t.tone === "bad" ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1">{t.message}</p>
            <button type="button" onClick={() => remove(t.id)} className="text-muted hover:text-fg" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
