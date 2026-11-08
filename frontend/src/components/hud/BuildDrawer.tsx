"use client";

/**
 * 底部建造「背包」（16 §4.4）：从底部滑出，内部为分类页签 + 背包格卡牌。
 * 点背景 / ✕ / ESC 收起；抽屉收起时卡牌仍可通过能力坞重新打开。
 */
import { useEffect } from "react";
import BuildCards from "@/components/game/ToolBar";
import { PixelIcon } from "@/components/ui/PixelSprite";

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
        className="pointer-events-auto absolute inset-0 bg-[rgba(42,35,64,0.3)] px-anim-fade"
      />
      <div className="pointer-events-auto relative mx-auto max-h-[78vh] w-full max-w-6xl overflow-y-auto px-3 pb-4 pt-2 sm:px-5">
        <div className="px-panel px-anim-slide-up p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2.5 text-[22px] font-normal leading-none">
              <PixelIcon name="build" scale={2} />
              建造背包
              <span className="hidden text-[13px] text-[var(--px-ink-soft)] sm:inline">
                选一个区块，点沙盘放下去
              </span>
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="收起"
              className="px-icon-btn"
            >
              <PixelIcon name="close" scale={1} />
            </button>
          </div>
          <BuildCards onPick={onClose} />
        </div>
      </div>
    </div>
  );
}
