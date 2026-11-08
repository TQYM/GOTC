"use client";

/**
 * 底部建造卡牌抽屉内容（WorldBox 重构，PR-37）：
 * - 分类 tab（全部/住宅/商业/工业/绿地/服务/交通/市政）+ 卡牌网格，人话化信息保留（14 §2.1）；
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

const TILE_ICON: Record<TileType, string> = {
  res_low: "🏡",
  res_mid: "🏘️",
  res_high: "🏙️",
  com_shop: "🛍️",
  com_cbd: "🏦",
  ind_light: "🔧",
  ind_heavy: "🏭",
  green_park: "🌳",
  green_plaza: "⛲",
  edu_school: "🏫",
  med_clinic: "🏥",
  trans_metro: "🚇",
  trans_road: "🛣️",
  util_bridge: "🌉",
};

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
        {type === "util_bridge" ? "/格" : ""} · {type === "util_bridge" ? "1×N" : spec.footprint.join("×")}
      </span>
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
      className={`wb-card min-h-[4.6rem] px-2.5 py-2 text-left ${!affordable || disabled ? "opacity-45" : ""} ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-lg leading-none" aria-hidden>
          {TILE_ICON[type]}
        </span>
        <span
          className="mt-1 h-2 w-2 rounded-full"
          style={{ background: CATEGORY_COLORS[spec.category] }}
          aria-hidden
        />
      </div>
      <div className="mt-1 truncate text-[13px] font-bold">{spec.name}</div>
      <div className="truncate text-[11px] text-[var(--wb-ink-muted)]">{spec.blurb}</div>
      <div className="mt-0.5 text-[11px] tabular-nums text-[var(--wb-gold-strong)]">
        {yuan(spec.cost)}
        {type === "util_bridge" ? "/格" : ""}
        <span className="ml-1 text-[var(--wb-ink-muted)]">
          {type === "util_bridge" ? "1×N" : spec.footprint.join("×")}
        </span>
      </div>
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
    <div className="flex min-h-0 flex-col gap-2" data-testid="toolbar" role="toolbar" aria-label="建造工具栏">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="区块分类">
        {CATS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={cat === c.key}
            onClick={() => setCat(c.key)}
            className="wb-tab"
          >
            {c.label}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[11px] text-[var(--wb-ink-muted)]">
          拖到沙盘也可放置
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
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
