"use client";

/**
 * 底部建造「背包」内容（16 §4.4 像素风）：
 * - 分类页签（全部/住宅/商业/工业/绿地/服务/交通/市政）+ 背包格卡牌，卡头是区块等距像素缩略图；
 * - 人话化信息保留（14 §2.1）；
 * - 点选 = 进入放置模式（可连续放置，右键 / ESC 退出）；卡牌可直接拖到沙盘（@dnd-kit）；
 * - 资金不足按本地缓存置灰（真值以后端为准）；触控目标 ≥64px。
 * testid `toolbar` / `tool-*` 保留。
 */
import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { TileType } from "@/lib/contract";
import { TILE_ORDER, TILE_SPECS, type TileCategory } from "@/lib/catalog";
import { yuan } from "@/lib/api/humanize";
import { CATEGORY_COLORS } from "@/lib/palette";
import { useGame } from "@/store/game";
import { TileThumb } from "@/components/ui/PixelSprite";

const CATS: { key: TileCategory | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "residential", label: "住宅" },
  { key: "commercial", label: "商业" },
  { key: "industrial", label: "工业" },
  { key: "green", label: "绿地" },
  { key: "service", label: "服务" },
  { key: "transport", label: "交通" },
  { key: "utility", label: "市政" },
];

export function TileCardFace({ type, compact = false }: { type: TileType; compact?: boolean }) {
  const spec = TILE_SPECS[type];
  return (
    <div className="flex items-center gap-2.5 text-left leading-tight">
      <TileThumb type={type} scale={2} />
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-[15px]">
          <span className="px-dot" style={{ background: CATEGORY_COLORS[spec.category] }} />
          {spec.name}
        </span>
        {!compact && <span className="text-xs text-[var(--px-ink-soft)]">{spec.blurb}</span>}
        <span className="text-xs">
          {yuan(spec.cost)}
          {type === "util_bridge" ? "/格" : ""} · {type === "util_bridge" ? "1×N" : spec.footprint.join("×")}
        </span>
      </div>
    </div>
  );
}

function TileCard({
  type,
  active,
  affordable,
  disabled,
  onPick,
}: {
  type: TileType;
  active: boolean;
  affordable: boolean;
  disabled: boolean;
  onPick?: () => void;
}) {
  const setTool = useGame((s) => s.setTool);
  const exitTool = useGame((s) => s.exitTool);
  const toast = useGame((s) => s.toast);
  const spec = TILE_SPECS[type];
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
      aria-label={`${spec.name}：${spec.blurb}，${yuan(spec.cost)}`}
      title={`${spec.name}：${spec.blurb}`}
      onClick={() => {
        if (disabled) return;
        if (!affordable) {
          toast({ tone: "info", title: "钱不够建这个", hint: "快进一年收税，或拆掉建筑收回 30%" });
          return;
        }
        if (active) exitTool();
        else {
          setTool({ kind: "place", type });
          onPick?.();
        }
      }}
      className={`px-card flex min-h-[9.5rem] flex-col gap-1 px-2 pb-2 text-left ${!affordable || disabled ? "opacity-45" : ""} ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <span
        className="-mx-2 block h-[5px]"
        style={{ background: CATEGORY_COLORS[spec.category] }}
        aria-hidden
      />
      <span className="grid h-[62px] place-items-center" aria-hidden>
        <TileThumb type={type} scale={2} />
      </span>
      <span className="truncate text-[15px] leading-tight">{spec.name}</span>
      <span className="min-h-[14px] truncate text-[11px] leading-tight text-[var(--px-ink-soft)]">
        {spec.blurb}
      </span>
      <span className="mt-auto flex items-center justify-between gap-1 text-[13px] tabular-nums">
        <span>
          {yuan(spec.cost)}
          {type === "util_bridge" ? "/格" : ""}
        </span>
        <span className="bg-[var(--px-ink)] px-1 text-[11px] text-[var(--px-paper)]">
          {type === "util_bridge" ? "1×N" : spec.footprint.join("×")}
        </span>
      </span>
    </button>
  );
}

export default function BuildCards({ onPick }: { onPick?: () => void }) {
  const tool = useGame((s) => s.tool);
  const funds = useGame((s) => s.metrics?.funds ?? null);
  const phase = useGame((s) => s.phase);
  const [cat, setCat] = useState<TileCategory | "all">("all");
  const disabled = phase !== "building";

  const shown = TILE_ORDER.filter(
    (t) => cat === "all" || TILE_SPECS[t].category === cat,
  );

  return (
    <div className="flex min-h-0 flex-col gap-4" data-testid="toolbar" role="toolbar" aria-label="建造工具栏">
      <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="区块分类">
        {CATS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={cat === c.key}
            onClick={() => setCat(c.key)}
            className="px-tab"
          >
            <span
              className="px-dot"
              style={{
                background: c.key === "all" ? "var(--px-ink)" : CATEGORY_COLORS[c.key],
              }}
              aria-hidden
            />
            {c.label}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[12px] text-[var(--px-ink-soft)]">
          拖到沙盘也可放置
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3.5 p-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
        {shown.map((t) => (
          <TileCard
            key={t}
            type={t}
            disabled={disabled}
            active={tool.kind === "place" && tool.type === t}
            affordable={funds === null || TILE_SPECS[t].cost <= funds}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}
