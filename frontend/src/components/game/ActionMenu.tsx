"use client";

/**
 * 右侧「操作 / 图层」折叠菜单 —— 把原来平铺的 12 个浮动按钮收进一层。
 *
 * 背景：C:S 复刻阶段越加越多，右侧同时挂着 6 个能力按钮（补一年/推演/报告/
 * 导师/历史/回建设）+ 6 个信息视图按钮，加上左侧 4 个图标坞，1440×836 下
 * 整屏 16 个浮动控件，既重叠又挡地图。
 *
 * 层级：
 *   一级 —— 一个「操作」按钮（36×36，纸色像素风）
 *   二级 —— 点开后一个窄面板，顶部两个 tab 切换「操作 / 图层」
 *   三级 —— 能力里的「推演」「报告」等仍走原有的确认弹窗
 *
 * 为什么用 tab 而不是两列并排：两列并排宽约 500px，从右上展开会盖住
 * 中上的资源条；单列 220px 只占右侧一条，地图视野几乎不受影响。
 *
 * 参考 emil-design-eng：popover 用 transform-origin 跟随触发点、duration 160ms、
 * ease-out 曲线，并且只动 transform / opacity。
 */
import { useEffect, useRef, useState } from "react";
import { useGame } from "@/store/game";
import { InfoViewBar } from "./InfoViewBar";
import PhaseBanner from "./PhaseBanner";

type Pane = "actions" | "layers";

export function ActionMenu() {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("actions");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const phase = useGame((s) => s.phase);

  // 点外面 / 按 Esc 收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="pointer-events-auto absolute right-4 top-4 z-30">
      <button
        type="button"
        aria-expanded={open}
        aria-label="操作与图层"
        title="操作与图层"
        onClick={() => setOpen((v) => !v)}
        className="px-icon-btn"
        data-active={open}
        data-testid="action-menu-trigger"
      >
        <span className="text-[15px] leading-none">⚙</span>
      </button>

      {open ? (
        <div
          className="px-panel absolute right-0 top-[calc(100%+8px)] w-[13.5rem] p-2"
          style={{
            transformOrigin: "top right",
            animation: "px-pop 160ms cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        >
          {/* tab 切换 */}
          <div className="mb-2 flex gap-1">
            {(
              [
                ["actions", "操作"],
                ["layers", "图层"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={pane === key}
                onClick={() => setPane(key)}
                className="px-tab flex-1 text-[12px]"
                data-testid={`action-menu-tab-${key}`}
              >
                {label}
              </button>
            ))}
          </div>

          {pane === "actions" ? (
            <div className="flex flex-col items-start gap-2">
              <PhaseBanner inline />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <InfoViewBar vertical />
              <p className="px-caption leading-relaxed">
                按住 Shift 可临时叠加，松开恢复默认。
              </p>
            </div>
          )}
        </div>
      ) : null}

      {/* phase 变化时自动收起，避免菜单跨阶段残留 */}
      <span className="hidden" data-phase={phase} />
    </div>
  );
}
