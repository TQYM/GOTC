"use client";

/**
 * 3D 沙盘预览页（PR-04 验收用）：mock 地块 + 全部 14 种区块、悬停拾取、放置 ghost、帧率/draw call。
 * 主游戏页接入真后端后，本页保留为离线演示与渲染回归入口。
 */
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import type { GhostSpec, SceneStats } from "@/components/scene/CityScene3D";
import { footprintCells } from "@/components/scene/coords";
import type { Cell, Terrain, TileType } from "@/lib/contract";
import { TILE_ORDER, TILE_SPECS, type TileCategory } from "@/lib/catalog";
import { MOCK_SESSION } from "@/lib/mock";
import { CATEGORY_COLORS, TERRAIN_COLORS } from "@/lib/palette";

const CityScene3D = dynamic(() => import("@/components/scene/CityScene3D"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-fg-muted">
      加载 3D 场景…
    </div>
  ),
});

const TERRAIN_LABELS: Record<Terrain, string> = {
  flat: "平原",
  hill: "丘陵",
  river: "河道",
  bank: "河岸",
  forest: "林地",
  road_inherited: "既有道路",
  occupied: "既有建筑",
};

const CATEGORY_LABELS: Record<TileCategory, string> = {
  residential: "住宅",
  commercial: "商业",
  industrial: "工业",
  green: "绿地",
  service: "公共服务",
  transport: "交通",
  utility: "市政",
};

/** 仅用于预览 ghost 红绿：越界 / 不可建地形 / 已占用。正式预校验在 PR-05，最终以后端为准 */
const BLOCKED: Terrain[] = ["river", "forest", "road_inherited", "occupied"];

export default function SandboxView() {
  const { parcel, tiles } = MOCK_SESSION;
  const [showTiles, setShowTiles] = useState(true);
  const [shadows, setShadows] = useState(true);
  const [tool, setTool] = useState<TileType | "">("");
  const [hover, setHover] = useState<Cell | null>(null);
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [resetView, setResetView] = useState(0);

  const shownTiles = useMemo(
    () => (showTiles ? tiles : []),
    [showTiles, tiles],
  );
  const occupied = useMemo(
    () =>
      new Set(shownTiles.flatMap((t) => t.cells.map(([r, c]) => `${r},${c}`))),
    [shownTiles],
  );
  const hoverTile = useMemo(
    () =>
      hover
        ? shownTiles.find((t) =>
            t.cells.some(([r, c]) => r === hover[0] && c === hover[1]),
          )
        : undefined,
    [hover, shownTiles],
  );

  const ghost = useMemo<GhostSpec | null>(() => {
    if (!tool || !hover || tool === "util_bridge") return null;
    const cells = footprintCells(tool, hover);
    const valid = cells.every(
      ([r, c]) =>
        r < parcel.size &&
        c < parcel.size &&
        !BLOCKED.includes(parcel.terrain[r][c]) &&
        !(
          parcel.terrain[r][c] === "bank" &&
          TILE_SPECS[tool].category !== "green"
        ) &&
        !occupied.has(`${r},${c}`),
    );
    return { type: tool, anchor: hover, valid };
  }, [tool, hover, parcel, occupied]);

  const onStats = useCallback((s: SceneStats) => setStats(s), []);

  return (
    <main className="flex h-screen flex-col gap-3 p-3 lg:flex-row">
      <section className="min-h-[60vh] flex-1 overflow-hidden rounded-lg border border-line lg:min-h-0">
        <CityScene3D
          parcel={parcel}
          tiles={shownTiles}
          ghost={ghost}
          shadows={shadows}
          onCellHover={setHover}
          onStats={onStats}
          resetViewSignal={resetView}
          debugHook
        />
      </section>

      <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line bg-bg-elev p-4 text-sm lg:w-72">
        <div>
          <h1 className="text-base font-semibold">
            3D 沙盘预览 · seed {parcel.seed}
          </h1>
          <p className="mt-1 text-fg-muted">
            {parcel.constraints.briefing.text}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            右键拖动旋转 · 中键 / WASD 平移 · 滚轮向光标缩放 · Home 回到全景
          </p>
        </div>

        <div className="space-y-1" data-testid="hover-info">
          <div className="text-fg-muted">悬停格</div>
          {hover ? (
            <div data-testid="hover-cell" data-r={hover[0]} data-c={hover[1]}>
              [{hover[0]}, {hover[1]}] ·{" "}
              {TERRAIN_LABELS[parcel.terrain[hover[0]][hover[1]]]}
              {hoverTile ? ` · ${TILE_SPECS[hoverTile.type].name}` : ""}
            </div>
          ) : (
            <div className="text-fg-muted">—</div>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-fg-muted">放置预览（ghost）</span>
          <select
            value={tool}
            onChange={(e) => setTool(e.target.value as TileType | "")}
            className="rounded border border-line bg-bg px-2 py-1"
            data-testid="tool-select"
          >
            <option value="">不预览</option>
            {TILE_ORDER.filter((t) => t !== "util_bridge").map((t) => (
              <option key={t} value={t}>
                {TILE_SPECS[t].name}（{TILE_SPECS[t].footprint.join("×")}）
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setResetView((n) => n + 1)}
          className="self-start rounded border border-line px-2 py-1 hover:bg-line"
        >
          回到全景（Home）
        </button>

        <div className="space-y-1">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showTiles}
              onChange={(e) => setShowTiles(e.target.checked)}
            />
            显示区块（{tiles.length} 个，含全部 14 种）
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={shadows}
              onChange={(e) => setShadows(e.target.checked)}
            />
            阴影
          </label>
        </div>

        <div className="space-y-1" data-testid="scene-stats">
          <div className="text-fg-muted">
            性能（11 §6.4：≥55fps，draw call ≤60）
          </div>
          <div>
            帧率：<span data-testid="fps">{stats?.fps ?? "—"}</span> fps
          </div>
          <div>
            Draw call：
            <span data-testid="draw-calls">{stats?.drawCalls ?? "—"}</span>
          </div>
          <div>
            三角形：
            <span data-testid="triangles">
              {stats?.triangles.toLocaleString() ?? "—"}
            </span>
          </div>
        </div>

        <Legend
          title="地形"
          items={(Object.keys(TERRAIN_COLORS) as Terrain[]).map((t) => [
            TERRAIN_LABELS[t],
            TERRAIN_COLORS[t],
          ])}
        />
        <Legend
          title="区块大类"
          items={(Object.keys(CATEGORY_COLORS) as TileCategory[]).map((k) => [
            CATEGORY_LABELS[k],
            CATEGORY_COLORS[k],
          ])}
        />
      </aside>
    </main>
  );
}

function Legend({
  title,
  items,
}: {
  title: string;
  items: [string, string][];
}) {
  return (
    <div>
      <div className="mb-1 text-fg-muted">{title}</div>
      <ul className="grid grid-cols-2 gap-1">
        {items.map(([label, color]) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: color }}
            />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
