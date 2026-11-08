"use client";

/**
 * 左下能力坞（16 §4.4）：方块快捷栏——建造 / 拆除 / 更新改造 / 选择 / 城市面板 / 消息，按钮下标 1–6 键位提示。
 * 建造展开底部背包抽屉；其余直接切换游戏工具（逻辑全部沿用 store，不改玩法）。
 */
import { PixelIcon } from "@/components/ui/PixelSprite";
import type { IconName } from "@/lib/pixelArt";
import { useGame } from "@/store/game";

interface Props {
  buildOpen: boolean;
  onOpenBuild: () => void;
  onOpenPanel: (tab: "city" | "feed") => void;
  panelTab: "city" | "feed" | null;
}

function DockButton({
  testId,
  icon,
  label,
  hotkey,
  active = false,
  disabled = false,
  onClick,
}: {
  testId?: string;
  icon: IconName;
  label: string;
  hotkey: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className="px-btn h-14 w-14"
    >
      <PixelIcon name={icon} scale={2} />
      <span className="px-key" aria-hidden>
        {hotkey}
      </span>
    </button>
  );
}

export default function AbilityDock({ buildOpen, onOpenBuild, onOpenPanel, panelTab }: Props) {
  const tool = useGame((s) => s.tool);
  const phase = useGame((s) => s.phase);
  const busy = useGame((s) => s.busy);
  const setTool = useGame((s) => s.setTool);
  const exitTool = useGame((s) => s.exitTool);
  const buildable = phase === "building" && !busy;

  const hint =
    tool.kind === "place"
      ? "放置模式 · 左键落子，右键 / ESC 退出"
      : tool.kind === "remove"
        ? "拆除模式 · 点地块确认拆除"
        : tool.kind === "redevelop"
          ? "更新改造模式 · 点既有建筑"
          : "点「建造」挑区块，或直接点地块看详情";

  return (
    <div
      className="pointer-events-auto flex flex-col items-start gap-4"
      data-testid="ability-dock"
      role="toolbar"
      aria-label="能力坞"
    >
      <p className="flex items-center gap-2 bg-[var(--px-ink)] px-3 py-1.5 text-[13px] leading-none text-[var(--px-paper)] shadow-[4px_5px_0_rgba(42,35,64,0.3)]">
        <span className="inline-block h-2 w-2 bg-[var(--px-sun)]" aria-hidden />
        {hint}
      </p>
      <div className="flex items-center gap-3.5 pb-1">
        <DockButton
          testId="dock-build"
          icon="build"
          hotkey="1"
          label={buildOpen ? "收起建造背包" : "建造"}
          active={buildOpen || tool.kind === "place"}
          disabled={phase !== "building"}
          onClick={onOpenBuild}
        />
        <DockButton
          testId="tool-remove"
          icon="remove"
          hotkey="2"
          label="拆除（返还 30%）"
          active={tool.kind === "remove"}
          disabled={!buildable}
          onClick={() => (tool.kind === "remove" ? exitTool() : setTool({ kind: "remove" }))}
        />
        <DockButton
          testId="tool-redevelop"
          icon="redevelop"
          hotkey="3"
          label="更新改造（点既有建筑）"
          active={tool.kind === "redevelop"}
          disabled={!buildable}
          onClick={() =>
            tool.kind === "redevelop" ? exitTool() : setTool({ kind: "redevelop" })
          }
        />
        <DockButton
          testId="dock-select"
          icon="select"
          hotkey="4"
          label="结束当前工具"
          active={tool.kind === "select"}
          onClick={exitTool}
        />
        <div className="mx-0.5 h-11 w-1 bg-[var(--px-ink)] opacity-35" aria-hidden />
        <DockButton
          testId="dock-city"
          icon="city"
          hotkey="5"
          label="城市面板"
          active={panelTab === "city"}
          onClick={() => onOpenPanel("city")}
        />
        <DockButton
          testId="dock-feed"
          icon="feed"
          hotkey="6"
          label="城市动态"
          active={panelTab === "feed"}
          onClick={() => onOpenPanel("feed")}
        />
      </div>
    </div>
  );
}
