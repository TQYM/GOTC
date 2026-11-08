"use client";

/**
 * 左下能力坞（WorldBox 重构）：圆形能力按钮——建造 / 拆除 / 更新改造 / 选择 / 城市面板 / 消息。
 * 建造展开底部卡牌抽屉；其余直接切换游戏工具（逻辑全部沿用 store，不改玩法）。
 */
import { useGame } from "@/store/game";

interface Props {
  buildOpen: boolean;
  onOpenBuild: () => void;
  onOpenPanel: (tab: "city" | "feed") => void;
  panelTab: "city" | "feed" | null;
}

function RoundButton({
  testId,
  icon,
  label,
  active = false,
  disabled = false,
  tone,
  onClick,
}: {
  testId?: string;
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  tone?: string;
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
      className="wb-round relative"
      style={tone ? { color: tone } : undefined}
    >
      <span className="text-xl leading-none" aria-hidden>
        {icon}
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

  return (
    <div
      className="pointer-events-auto flex flex-col gap-2"
      data-testid="ability-dock"
      role="toolbar"
      aria-label="能力坞"
    >
      <div className="flex items-end gap-2">
        <RoundButton
          testId="dock-build"
          icon="🏗️"
          label={buildOpen ? "收起建造卡牌" : "建造"}
          active={buildOpen}
          disabled={phase !== "building"}
          onClick={onOpenBuild}
        />
        <RoundButton
          testId="tool-remove"
          icon="🔨"
          label="拆除（返还 30%）"
          active={tool.kind === "remove"}
          disabled={!buildable}
          onClick={() => (tool.kind === "remove" ? exitTool() : setTool({ kind: "remove" }))}
        />
        <RoundButton
          testId="tool-redevelop"
          icon="🏚️"
          label="更新改造（点既有建筑）"
          active={tool.kind === "redevelop"}
          disabled={!buildable}
          onClick={() =>
            tool.kind === "redevelop" ? exitTool() : setTool({ kind: "redevelop" })
          }
        />
        <RoundButton
          testId="dock-select"
          icon="✋"
          label="结束当前工具"
          active={tool.kind === "select"}
          onClick={exitTool}
        />
        <div className="mx-1 h-10 w-px self-center bg-[var(--wb-gold-line)]" aria-hidden />
        <RoundButton
          testId="dock-city"
          icon="📊"
          label="城市面板"
          active={panelTab === "city"}
          onClick={() => onOpenPanel("city")}
        />
        <RoundButton
          testId="dock-feed"
          icon="💬"
          label="城市动态"
          active={panelTab === "feed"}
          onClick={() => onOpenPanel("feed")}
        />
      </div>
      <p className="pl-1 text-[11px] text-[var(--wb-ink-muted)] drop-shadow">
        {tool.kind === "place"
          ? "放置模式 · 左键落子，右键 / ESC 退出"
          : tool.kind === "remove"
            ? "拆除模式 · 点地块确认拆除"
            : tool.kind === "redevelop"
              ? "更新改造模式 · 点既有建筑"
              : "点 🏗️ 选择区块，点地块放置"}
      </p>
    </div>
  );
}
