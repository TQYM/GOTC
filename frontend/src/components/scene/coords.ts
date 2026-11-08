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

/* ======================================================================
 * 全域地图坐标（PR-36）：北京全域数据包 data/parcels/beijing_full。
 *
 * 地图局部坐标（数据包 crs）：EPSG:32650，原点 = bbox 西南角，x 东、y 北，单位米；
 * 网格 r 行 c 列：r = floor(y / cell)（行号自南向北递增），c = floor(x / cell)。
 * 世界坐标（three.js）：以地图中心为原点，wx = x − W/2，wz = −(y − H/2)（北 = −z）。
 * ==================================================================== */

export interface MapFrame {
  rows: number;
  cols: number;
  cell: number;
  /** 地图宽（东西）/ 高（南北），米 */
  width: number;
  height: number;
}

export function mapFrame(grid: {
  rows: number;
  cols: number;
  cell_m: number;
}): MapFrame {
  return {
    rows: grid.rows,
    cols: grid.cols,
    cell: grid.cell_m,
    width: grid.cols * grid.cell_m,
    height: grid.rows * grid.cell_m,
  };
}

/** 地图局部 (x 东, y 北) → 世界 (wx, wz) */
export function mapToWorld(
  f: MapFrame,
  x: number,
  y: number,
): [number, number] {
  return [x - f.width / 2, -(y - f.height / 2)];
}

/** 世界 (wx, wz) → 地图局部 (x, y) */
export function worldToMap(
  f: MapFrame,
  wx: number,
  wz: number,
): [number, number] {
  return [wx + f.width / 2, f.height / 2 - wz];
}

/**
 * 地表高度采样：与地形网格完全一致的三角面插值（角点高程 = 相邻 4 格均值，
 * 每格按 (c0,r0)-(c1,r1) 对角线切成两个三角形），道路 / 水面 / 建筑贴地都用它，避免穿插。
 */
export class Surface {
  private corners: Float32Array;
  constructor(
    readonly f: MapFrame,
    elevation: Float32Array,
  ) {
    const { rows: R, cols: C } = f;
    this.corners = new Float32Array((R + 1) * (C + 1));
    for (let r = 0; r <= R; r++) {
      for (let c = 0; c <= C; c++) {
        let sum = 0;
        let n = 0;
        for (let rr = r - 1; rr <= r; rr++) {
          for (let cc = c - 1; cc <= c; cc++) {
            if (rr >= 0 && rr < R && cc >= 0 && cc < C) {
              sum += elevation[rr * C + cc];
              n++;
            }
          }
        }
        this.corners[r * (C + 1) + c] = n ? sum / n : 0;
      }
    }
  }

  /** 角点高程（格角 (r, c)，0 ≤ r ≤ rows，0 ≤ c ≤ cols） */
  corner(r: number, c: number): number {
    return this.corners[r * (this.f.cols + 1) + c];
  }

  /** 地图局部 (x, y) 处的地表高度（米） */
  heightAt(x: number, y: number): number {
    const { cell, rows, cols } = this.f;
    const fx = Math.min(Math.max(x / cell, 0), cols - 1e-6);
    const fy = Math.min(Math.max(y / cell, 0), rows - 1e-6);
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    const u = fx - c;
    const v = fy - r;
    const h00 = this.corner(r, c);
    const h10 = this.corner(r, c + 1);
    const h01 = this.corner(r + 1, c);
    const h11 = this.corner(r + 1, c + 1);
    // 对角线 (0,0)-(1,1)：u ≥ v 用三角形 (00,10,11)，否则 (00,11,01)
    return u >= v
      ? h00 + (h10 - h00) * u + (h11 - h10) * v
      : h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
}

/** WGS84 经纬度 → UTM 50N（EPSG:32650）东 / 北向坐标（米），标准横轴墨卡托级数 */
export function utm50(lat: number, lon: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const p = (lat * Math.PI) / 180;
  const l = ((lon - 117) * Math.PI) / 180;
  const sin = Math.sin(p);
  const cos = Math.cos(p);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = Math.tan(p) ** 2;
  const C = ep2 * cos * cos;
  const A = l * cos;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M =
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * p -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * p) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * p) -
      ((35 * e6) / 3072) * Math.sin(6 * p));
  const E =
    500000 +
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const Nn =
    k0 *
    (M +
      N *
        Math.tan(p) *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [E, Nn];
}

/** 两个数据包局部原点（各自 bbox 西南角）之间的米制偏移 */
export function originOffset(
  from: { south: number; west: number },
  to: { south: number; west: number },
): [number, number] {
  const [e0, n0] = utm50(from.south, from.west);
  const [e1, n1] = utm50(to.south, to.west);
  return [e1 - e0, n1 - n0];
}

/**
 * 可玩沙盘（48×48 @50m）在全域地图上的位置：朝阳 CBD–通惠河片区（11 §2）。
 * 优先用 parcel.origin（沙盘西南角的 EPSG:32650 坐标，后端 / 数据包给出）；
 * 没有时（随机沙盒、mock）退回 data/parcels/beijing_cbd/source.json 的 origin。
 * 返回沙盘中心的全域地图局部坐标与半边长。
 */
export const CBD_PARCEL_ORIGIN_UTM: [number, number] = [451876.29, 4416801.3];

export interface BoardSpec {
  size: number;
  cell_size_m: number;
  origin?: number[] | null;
}

export function boardOriginUtm(board: BoardSpec): [number, number] {
  const o = board.origin;
  return o &&
    o.length >= 2 &&
    Number.isFinite(o[0]) &&
    Number.isFinite(o[1]) &&
    o[0] > 100000 &&
    o[1] > 1000000
    ? [o[0], o[1]]
    : CBD_PARCEL_ORIGIN_UTM;
}

export function boardAnchorOnMap(
  mapBbox: { south: number; west: number },
  board: BoardSpec,
): { x: number; y: number; half: number } {
  const [e0, n0] = utm50(mapBbox.south, mapBbox.west);
  const [e1, n1] = boardOriginUtm(board);
  const half = (board.size * board.cell_size_m) / 2;
  return { x: e1 - e0 + half, y: n1 - n0 + half, half };
}
