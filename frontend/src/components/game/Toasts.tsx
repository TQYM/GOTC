"use client";

import { useGame } from "@/store/game";

const TONE = {
  ok: "border-emerald-400/60 bg-emerald-950/90",
  error: "border-red-400/70 bg-red-950/90",
  info: "border-sky-400/60 bg-slate-900/95",
} as const;

/** 人话 toast（14 §2.1）；网络类错误带一键重试（05 §3.3，不自动重试） */
export default function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex flex-col items-center gap-2 px-3"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid={`toast-${t.tone}`}
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border px-4 py-2 text-sm shadow-lg ${TONE[t.tone]}`}
        >
          <div>
            <div className="font-semibold">{t.title}</div>
            {t.hint && <div className="text-xs text-fg-muted">{t.hint}</div>}
          </div>
          {t.retry && (
            <button
              type="button"
              className="min-h-10 rounded border border-line px-3 text-xs hover:bg-line"
              onClick={() => {
                dismiss(t.id);
                t.retry?.();
              }}
            >
              重试
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
