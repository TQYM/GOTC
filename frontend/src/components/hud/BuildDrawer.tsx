"use client";

/**
 * 底部建造抽屉（WorldBox 重构）：从底部滑出，半屏高，内部为分类卡牌网格。
 * 点背景 / ✕ / ESC 收起；抽屉收起时卡牌仍可通过能力坞重新打开。
 */
import { useEffect } from "react";
import BuildCards from "@/components/game/ToolBar";

export default function BuildDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end">
      <button
        type="button"
        aria-label="收起建造面板"
        onClick={onClose}
        className="pointer-events-auto absolute inset-0 bg-black/25 wb-anim-fade"
      />
      <div className="pointer-events-auto relative mx-auto w-full max-w-5xl px-2 pb-2 sm:px-4">
        <div className="wb-panel wb-anim-slide-up rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <span aria-hidden>🏗️</span> 建造
              <span className="text-[11px] font-normal text-[var(--wb-ink-muted)]">
                选一个区块，点沙盘放下去
              </span>
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="收起"
              className="grid h-8 w-8 place-items-center rounded-full border border-[var(--wb-gold-line)] text-sm text-[var(--wb-ink-muted)] transition hover:border-[var(--wb-gold)] hover:text-[var(--wb-ink)] active:scale-95"
            >
              ✕
            </button>
          </div>
          <BuildCards onPick={onClose} />
        </div>
      </div>
    </div>
  );
}
