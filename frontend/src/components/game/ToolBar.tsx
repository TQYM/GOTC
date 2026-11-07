"use client";

/**
 * 底部建造工具栏（05 §2.3 / 14 §2.1 / 13 §4.3）：14 张人话化卡牌 + 拆除工具。
 * - 点选卡牌 = 进入放置模式（可连续放置，右键 / ESC 退出）；也可直接把卡牌拖到沙盘上（@dnd-kit）。
 * - 资金不足按本地缓存置灰（真值以后端为准）；触控目标 ≥64px（14 §2.3）。
 */
import { useDraggable } from "@dnd-kit/core";
import type { TileType } from "@/lib/contract";
import { TILE_ORDER, TILE_SPECS } from "@/lib/catalog";
import { yuan } from "@/lib/api/humanize";
import { CATEGORY_COLORS } from "@/lib/palette";
import { useGame } from "@/store/game";

export function TileCardFace({
  type,
  compact = false,
}: {
  type: TileType;
  compact?: boolean;
}) {
  const spec = TILE_SPECS[type];
  return (
    <div className="flex flex-col items-start gap-0.5 text-left leading-tight">
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: CATEGORY_COLORS[spec.category] }}
        />
        {spec.name}
      </span>
      {!compact && <span className="text-xs text-fg-muted">{spec.blurb}</span>}
      <span className="text-xs">
        {yuan(spec.cost)}
        {type === "util_bridge" ? "/格" : ""} ·{" "}
        {type === "util_bridge" ? "1×N" : spec.footprint.join("×")}
      </span>
    </div>
  );
}

function TileCard({
  type,
  active,
  affordable,
  disabled,
}: {
  type: TileType;
  active: boolean;
  affordable: boolean;
  disabled: boolean;
}) {
  const setTool = useGame((s) => s.setTool);
  const exitTool = useGame((s) => s.exitTool);
  const toast = useGame((s) => s.toast);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tile:${type}`,
    data: { type },
    disabled: disabled || !affordable,
  });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      data-testid={`tool-${type}`}
      aria-pressed={active}
      title={`${TILE_SPECS[type].name}：${TILE_SPECS[type].blurb}`}
      onClick={() => {
        if (disabled) return;
        if (!affordable) {
          toast({
            tone: "info",
            title: "钱不够建这个",
            hint: "快进一年收税，或拆掉建筑收回 30%",
          });
          return;
        }
        if (active) exitTool();
        else setTool({ kind: "place", type });
      }}
      className={`min-h-16 min-w-32 shrink-0 rounded-lg border px-3 py-2 transition ${
        active
          ? "border-accent bg-accent/20 ring-2 ring-accent"
          : "border-line bg-bg-elev hover:border-fg-muted"
      } ${!affordable || disabled ? "opacity-45" : ""} ${isDragging ? "opacity-30" : ""}`}
    >
      <TileCardFace type={type} />
    </button>
  );
}

export default function ToolBar() {
  const tool = useGame((s) => s.tool);
  const funds = useGame((s) => s.metrics?.funds ?? null);
  const phase = useGame((s) => s.phase);
  const setTool = useGame((s) => s.setTool);
  const exitTool = useGame((s) => s.exitTool);
  const disabled = phase !== "building";

  return (
    <div
      className="flex items-stretch gap-2 overflow-x-auto p-2"
      data-testid="toolbar"
      role="toolbar"
      aria-label="建造工具栏"
    >
      <button
        type="button"
        data-testid="tool-remove"
        aria-pressed={tool.kind === "remove"}
        onClick={() =>
          tool.kind === "remove" ? exitTool() : setTool({ kind: "remove" })
        }
        className={`min-h-16 min-w-20 shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold ${
          tool.kind === "remove"
            ? "border-red-400 bg-red-500/20 ring-2 ring-red-400"
            : "border-line bg-bg-elev hover:border-fg-muted"
        } ${disabled ? "opacity-45" : ""}`}
      >
        拆除
        <span className="block text-xs font-normal text-fg-muted">
          返还 30%
        </span>
      </button>
      {TILE_ORDER.map((t) => (
        <TileCard
          key={t}
          type={t}
          disabled={disabled}
          active={tool.kind === "place" && tool.type === t}
          affordable={funds === null || TILE_SPECS[t].cost <= funds}
        />
      ))}
    </div>
  );
}
