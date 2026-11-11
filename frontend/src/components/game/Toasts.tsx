"use client";

import { useGame } from "@/store/game";

/** 像素 toast：左侧色条表语气（ok 绿 / error 红 / info 蓝） */
const TONE = {
  ok: "var(--px-ok)",
  error: "var(--px-bad)",
  info: "var(--px-blue)",
} as const;

/** 人话 toast（14 §2.1）；网络类错误带一键重试（05 §3.3，不自动重试） */
export default function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-[15rem] z-30 flex flex-col items-center gap-4 px-3"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid={`toast-${t.tone}`}
          className="px-panel px-anim-rise pointer-events-auto flex max-w-md items-stretch gap-3 py-2 pl-2 pr-3 text-sm"
        >
          <span className="w-2 shrink-0" style={{ background: TONE[t.tone] }} aria-hidden />
          <div className="py-0.5">
            <div className="text-[15px]">{t.title}</div>
            {t.hint && <div className="mt-0.5 text-xs text-[var(--px-ink-soft)]">{t.hint}</div>}
          </div>
          {t.retry && (
            <button
              type="button"
              className="px-action ml-1 min-h-9 self-center text-xs"
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
