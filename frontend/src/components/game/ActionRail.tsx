"use client";

/**
 * 右侧竖排操作栏 —— 对齐用户要求的「操作做成竖的放到右边」。
 *
 * 与上一版 ActionMenu 的区别：那个是「一个 ⚙ 点开才看见」，这一版是
 * **常显的竖排按钮列**，鼠标不用点两次。代价是右侧固定占 56px 宽，
 * 换来的是「所有操作一眼可见」。
 *
 * 图层（信息视图）不常显 —— 它属于「看数据」而不是「做操作」，
 * 收在末尾一个「图层」按钮里，点开向上弹一个小面板，避免和图例抢位置。
 */
import { useEffect, useRef, useState } from "react";
import { useGame } from "@/store/game";
import { InfoViewBar } from "./InfoViewBar";
import PhaseBanner from "./PhaseBanner";

export function ActionRail() {
  const [layersOpen, setLayersOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!layersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setLayersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [layersOpen]);

  return (
    <div ref={boxRef} className="pointer-events-auto absolute right-3 top-[8.75rem] z-30 flex flex-col items-end gap-1.5">
      {/* 竖排操作：PhaseBanner 的 inline 模式本身就是 flex-col */}
      <div className="px-panel flex flex-col items-center gap-1.5 p-1.5">
        <PhaseBanner inline />
      </div>

      {/* 图层：点开向上弹 */}
      <div className="relative self-stretch">
        <button
          type="button"
          aria-expanded={layersOpen}
          onClick={() => setLayersOpen((v) => !v)}
          className="px-icon-btn w-full"
          data-active={layersOpen}
          data-testid="layers-trigger"
          title="图层"
        >
          <span className="text-[13px] leading-none">图</span>
        </button>

        {layersOpen ? (
          <div
            className="px-panel absolute right-0 bottom-[calc(100%+8px)] w-[10.5rem] p-2"
            style={{
              transformOrigin: "bottom right",
              animation: "px-pop 160ms cubic-bezier(0.23, 1, 0.32, 1)",
            }}
          >
            <InfoViewBar vertical />
          </div>
        ) : null}
      </div>
    </div>
  );
}
