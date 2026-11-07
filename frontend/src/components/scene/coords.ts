/**
 * 米制局部坐标（11 §6.1）：片区中心为原点，x 向东、z 向南、y 向上，单位米。
 * 格 (r, c) 中心 = ((c + 0.5 - N/2)·s, (r + 0.5 - N/2)·s)，s = cell_size_m。
 * 真实片区接入后，该坐标系与 EPSG:32650 仅差一个平移（片区中心）。
 */
import type { Cell, Parcel, Terrain, Tile, TileType } from "@/lib/contract";
import { TILE_SPECS } from "@/lib/catalog";

export interface Grid {
  size: number;
  cell: number;
}

export function gridOf(parcel: Parcel): Grid {
  return { size: parcel.size, cell: parcel.cell_size_m };
}

/** 格中心（可传小数取格内任意点）→ 世界 x/z */
export function cellToWorld(g: Grid, r: number, c: number): [number, number] {
  return [(c + 0.5 - g.size / 2) * g.cell, (r + 0.5 - g.size / 2) * g.cell];
}

/** 世界 x/z → 格；越界返回 null */
export function worldToCell(g: Grid, x: number, z: number): Cell | null {
  const c = Math.floor(x / g.cell + g.size / 2);
  const r = Math.floor(z / g.cell + g.size / 2);
  if (r < 0 || c < 0 || r >= g.size || c >= g.size) return null;
  return [r, c];
}

/** 地形视觉高度（米）：丘陵抬升、河道下沉；既有建筑底座另行绘制 */
export const TERRAIN_HEIGHT: Record<Terrain, number> = {
  flat: 0,
  hill: 3,
  river: -4,
  bank: 0,
  forest: 0,
  road_inherited: 0,
  occupied: 0,
};

/** 沙盘底座底面高度（米） */
export const PLINTH_BOTTOM = -14;

/** 由锚点 + 目录占地展开覆盖格（左上锚点，01 §3）；桥的真实占格以后端 cells 为准 */
export function footprintCells(type: TileType, anchor: Cell): Cell[] {
  const [h, w] = TILE_SPECS[type].footprint;
  const out: Cell[] = [];
  for (let dr = 0; dr < h; dr++)
    for (let dc = 0; dc < w; dc++) out.push([anchor[0] + dr, anchor[1] + dc]);
  return out;
}

export interface CellBounds {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** 覆盖格外接矩形（含端点） */
export function boundsOf(cells: Cell[]): CellBounds {
  let r0 = Infinity;
  let c0 = Infinity;
  let r1 = -Infinity;
  let c1 = -Infinity;
  for (const [r, c] of cells) {
    if (r < r0) r0 = r;
    if (c < c0) c0 = c;
    if (r > r1) r1 = r;
    if (c > c1) c1 = c;
  }
  return { r0, c0, r1, c1 };
}

/** 区块放置后的世界变换：外接矩形中心、底面高度、桥沿长轴的格数与朝向 */
export function tileTransform(
  g: Grid,
  parcel: Parcel,
  tile: Pick<Tile, "type" | "cells" | "orientation">,
) {
  const b = boundsOf(tile.cells);
  const [x, z] = cellToWorld(g, (b.r0 + b.r1) / 2, (b.c0 + b.c1) / 2);
  let base = -Infinity;
  for (const [r, c] of tile.cells) {
    const t = parcel.terrain[r]?.[c];
    base = Math.max(base, t === "river" ? 0 : TERRAIN_HEIGHT[t ?? "flat"]);
  }
  const vertical =
    tile.type === "util_bridge"
      ? (tile.orientation ??
          (b.c0 === b.c1 && b.r1 > b.r0 ? "vertical" : "horizontal")) ===
        "vertical"
      : false;
  const span = vertical ? b.r1 - b.r0 + 1 : b.c1 - b.c0 + 1;
  return { x, z, base: Number.isFinite(base) ? base : 0, span, vertical };
}
