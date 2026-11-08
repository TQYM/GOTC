"use client";

import { TILE_SPECS } from "@/lib/catalog";
import { yuan } from "@/lib/api/humanize";
import { useGame } from "@/store/game";

/** 拆除二次确认（05 §3.2）：显示返还金额；确认后才调 remove */
export default function RemoveConfirm() {
  const req = useGame((s) => s.confirmRemove);
  const busy = useGame((s) => s.busy);
  const cancel = useGame((s) => s.cancelRemove);
  const confirm = useGame((s) => s.confirmRemoveNow);
  if (!req) return null;
  const spec = TILE_SPECS[req.tile.type];
  return (
    <div
      className="absolute inset-0 z-40 grid place-items-center bg-[rgba(42,35,64,0.4)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-title"
    >
      <div
        className="px-panel px-anim-rise w-80 p-5"
        data-testid="remove-confirm"
      >
        <h2 id="remove-title" className="text-lg font-normal">
          拆除「{spec.name}」？
        </h2>
        <p className="mt-2 text-sm text-fg-muted">
          返还约{" "}
          <span className="px-chip bg-[var(--px-sun)] text-fg">{yuan(req.refund)}</span>
          （造价的 30%），拆除后不能撤销。
        </p>
        <div className="mt-5 flex justify-end gap-4">
          <button
            type="button"
            className="px-action"
            onClick={cancel}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="remove-confirm-ok"
            disabled={busy}
            className="px-action px-action-danger"
            onClick={() => void confirm()}
          >
            确认拆除
          </button>
        </div>
      </div>
    </div>
  );
}
