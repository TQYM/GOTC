/// <reference lib="webworker" />
/**
 * 全域地图 worker（PR-36）：下载 4 个静态 JSON（带进度）→ 解析 → 生成分槽 GPU 数组（零拷贝传回主线程）。
 *
 * - 地形：48×48 格分块 × 3 级分辨率（步长 1/2/4 格，<30km / 30–80km / ≥80km），每块带裙边遮挡级间裂缝；
 *   颜色走纹理（主线程 shader 采样）。
 * - 建筑：统一模型（lib/cityModel.ts）→ 16×16 格（3.2km）分块 × LOD 部件：
 *   <5km 精细（盒体 + 机房 + 坡屋顶 / 屋顶小件）、5–15km 中模（盒体 + 高层机房）、15–30km 无细节（盒体）、
 *   >30km 简模（只留 ≥40m 高层）；地标单独部件常显。
 * - 道路：3 档宽度（快速路 / 主次干道 / 支路），支路 15km 外、主次干道 60km 外隐藏；水系面用三角剖分，线状水系用 ribbon。
 * - 拾取：按格索引（格 → 建筑下标）+ 紧凑建筑表，主线程不对 7 万栋建筑做射线求交。
 */
import * as THREE from "three";
import {
  boardAnchorOnMap,
  mapFrame,
  mapToWorld,
  Surface,
  type MapFrame,
} from "@/components/scene/coords";
import {
  buildCellIndex,
  buildingColor,
  normalizeBuildings,
  toBuildingTable,
  TOON_ROOF_COLORS,
  type CityBuilding,
  type FullBuildingsFile,
} from "@saves/lib/cityModel";
import {
  BUILDING_PART,
  LOD_DISTANCE,
  type ChunkedGeometry,
  type FullMapData,
  type LoadStage,
  type MapLabel,
  type MapLandmark,
  type WorkerIn,
  type WorkerOut,
} from "./types";

const T_CHUNK = 48; // 地形 / 道路分块（格）
const B_CHUNK = 16; // 建筑分块（格）= 3.2km，LOD 切换粒度
const FAR = 1e12;

/** 地形 3 级分辨率：步长（格）与可见距离带 */
const TERRAIN_LEVELS: { step: number; band: [number, number] }[] = [
  { step: 1, band: [0, 30000] },
  { step: 2, band: [30000, 80000] },
  { step: 4, band: [80000, FAR] },
];
const SKIRT = 150; // 裙边下沉（米）

/** 道路 3 档：快速路 / 主次干道 / 支路 */
const ROAD_TIER_W = [70, 40, 18];
const ROAD_TIER_COLOR = ["#f6d68c", "#fbf9f4", "#efece5"];
const ROAD_TIER_BAND: [number, number][] = [
  [0, FAR],
  [0, 60000],
  [0, LOD_DISTANCE.medium],
];
function roadTier(kind: string): 0 | 1 | 2 {
  const k = kind.replace(/_link$/, "");
  if (k === "motorway" || k === "trunk") return 0;
  if (k === "primary" || k === "secondary") return 1;
  return 2;
}
const WATER_W: Record<string, number> = {
  river: 50,
  canal: 30,
  stream: 16,
  drain: 12,
  ditch: 10,
};
const ROAD_LIFT = 0.5;
const WATER_LIFT = 0.4;
const RIBBON_STEP = 200; // 米（= 1 格）：长线段细分，贴合起伏地形

const TERRAIN_COLORS: Record<string, string> = {
  flat: "#ebe7d8",
  road_inherited: "#d9d6cf",
  river: "#86cbe6",
  bank: "#bfe3d4",
  forest: "#9ad3ad",
  occupied: "#e3dccb",
  hill: "#cfc8ad",
  farmland: "#dbe9b6",
};

/** 建筑部件距离带（顺序与 BUILDING_PART 一致） */
const BUILDING_BANDS: [number, number][] = [
  [0, LOD_DISTANCE.noDetail], // base
  [0, LOD_DISTANCE.medium], // mid
  [0, LOD_DISTANCE.fine], // fine
  [LOD_DISTANCE.noDetail, FAR], // simple
  [0, FAR], // landmark
  [0, FAR], // boardLandmark
];
const SIMPLE_MIN_HEIGHT = 40;

const post = (m: WorkerOut, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);
const progress = (
  stage: LoadStage,
  ratio: number,
  extra: Partial<Extract<WorkerOut, { type: "progress" }>> = {},
) => post({ type: "progress", stage, ratio, ...extra });

/** sRGB 十六进制 → 字节（可选提亮）；linear=true 时转线性空间（顶点色在 three 中按线性解释） */
function rgb(
  hex: string,
  lighten = 0,
  linear = false,
): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const s = (v + (255 - v) * lighten) / 255;
    const l = linear
      ? s <= 0.04045
        ? s / 12.92
        : ((s + 0.055) / 1.055) ** 2.4
      : s;
    return Math.round(l * 255);
  };
  return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
}

/* ------------------------------------------------------------- 下载（带进度） */

async function fetchAll(base: string, files: string[]): Promise<unknown[]> {
  const sizes = await Promise.all(
    files.map(async (f) => {
      try {
        const h = await fetch(base + f, { method: "HEAD" });
        return Number(h.headers.get("content-length")) || 0;
      } catch {
        return 0;
      }
    }),
  );
  const total = sizes.reduce((a, b) => a + b, 0);
  let loaded = 0;
  return Promise.all(
    files.map(async (f) => {
      const res = await fetch(base + f);
      if (!res.ok || !res.body)
        throw new Error(`${f} 下载失败（HTTP ${res.status}）`);
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.byteLength;
        if (total)
          progress("download", Math.min(1, loaded / total), {
            loadedBytes: loaded,
            totalBytes: total,
          });
      }
      const buf = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0));
      let o = 0;
      for (const p of parts) {
        buf.set(p, o);
        o += p.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(buf));
    }),
  );
}

/* ------------------------------------------------------------- 分槽累积器 */

type Typed = Float32Array | Uint8Array | Uint32Array | Int8Array;

/** 可增长的类型化数组：避免百万级 number[] 的内存与 GC 压力 */
class Grow<T extends Typed> {
  len = 0;
  constructor(public arr: T) {}
  private ensure(n: number) {
    if (this.len + n <= this.arr.length) return;
    let cap = Math.max(64, this.arr.length * 2);
    while (cap < this.len + n) cap *= 2;
    const next = new (this.arr.constructor as { new (n: number): T })(cap);
    next.set(this.arr.subarray(0, this.len));
    this.arr = next;
  }
  push3(a: number, b: number, c: number) {
    this.ensure(3);
    this.arr[this.len++] = a;
    this.arr[this.len++] = b;
    this.arr[this.len++] = c;
  }
  push1(a: number) {
    this.ensure(1);
    this.arr[this.len++] = a;
  }
  view(): T {
    return this.arr.subarray(0, this.len) as T;
  }
}

type V3 = [number, number, number];

/** 槽 = 空间分块 × 部件；每个部件有自己的可见距离带 */
class SlotAccumulator {
  pos: Grow<Float32Array>[];
  nrm: Grow<Int8Array>[];
  col: Grow<Uint8Array>[] | null;
  idx: Grow<Uint32Array>[] | null;
  readonly n: number;
  constructor(
    spatial: number,
    readonly bands: [number, number][],
    withColor: boolean,
    indexed: boolean,
  ) {
    this.n = spatial * bands.length;
    const make = <T extends Typed>(ctor: { new (n: number): T }) =>
      Array.from({ length: this.n }, () => new Grow(new ctor(0)));
    this.pos = make(Float32Array);
    this.nrm = make(Int8Array);
    this.col = withColor ? make(Uint8Array) : null;
    this.idx = indexed ? make(Uint32Array) : null;
  }

  slot(k: number, part: number) {
    return k * this.bands.length + part;
  }

  vertex(s: number, p: V3, n: V3, c?: V3) {
    this.pos[s].push3(p[0], p[1], p[2]);
    this.nrm[s].push3(
      Math.round(n[0] * 127),
      Math.round(n[1] * 127),
      Math.round(n[2] * 127),
    );
    if (c && this.col) this.col[s].push3(c[0], c[1], c[2]);
  }

  /** 平面多边形（三角扇）：按 hint 方向自动统一绕向，法线取面法线 */
  face(s: number, pts: V3[], hint: V3, color?: V3) {
    const [a, b, c] = pts;
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    let order = pts;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      order = pts.slice().reverse();
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const v0 = this.pos[s].len / 3;
    for (const p of order) this.vertex(s, p, [nx, ny, nz], color);
    if (this.idx)
      for (let i = 1; i < order.length - 1; i++)
        this.idx[s].push3(v0, v0 + i, v0 + i + 1);
  }

  build(): ChunkedGeometry {
    const vTotal = this.pos.reduce((a, p) => a + p.len / 3, 0);
    const iTotal = this.idx ? this.idx.reduce((a, p) => a + p.len, 0) : 0;
    const position = new Float32Array(vTotal * 3);
    const normal = new Int8Array(vTotal * 3);
    const color = this.col ? new Uint8Array(vTotal * 3) : null;
    const index = this.idx ? new Uint32Array(iTotal) : null;
    const chunks = new Int32Array(this.n * 4);
    const boxes = new Float32Array(this.n * 6);
    const bands = new Float32Array(this.n * 2);
    const parts = new Uint8Array(this.n);
    const nParts = this.bands.length;
    let v = 0;
    let i = 0;
    for (let k = 0; k < this.n; k++) {
      const vc = this.pos[k].len / 3;
      const pv = this.pos[k].view();
      position.set(pv, v * 3);
      normal.set(this.nrm[k].view(), v * 3);
      if (color && this.col) color.set(this.col[k].view(), v * 3);
      const ic = this.idx ? this.idx[k].len : 0;
      if (index && this.idx) index.set(this.idx[k].view(), i);
      chunks.set([v, vc, i, ic], k * 4);
      const bb = [
        Infinity,
        Infinity,
        Infinity,
        -Infinity,
        -Infinity,
        -Infinity,
      ];
      for (let j = 0; j < pv.length; j += 3) {
        for (let d = 0; d < 3; d++) {
          const x = pv[j + d];
          if (x < bb[d]) bb[d] = x;
          if (x > bb[d + 3]) bb[d + 3] = x;
        }
      }
      if (vc) boxes.set(bb, k * 6);
      const part = k % nParts;
      bands.set(this.bands[part], k * 2);
      parts[k] = part;
      v += vc;
      i += ic;
    }
    this.pos = [];
    this.nrm = [];
    this.col = null;
    this.idx = null;
    return { position, normal, color, index, chunks, boxes, bands, parts };
  }
}

function triangles(g: ChunkedGeometry) {
  return Math.round(g.index ? g.index.length / 3 : g.position.length / 9);
}

/* ------------------------------------------------------------- 地形 */

function steps(from: number, to: number, step: number) {
  const out: number[] = [];
  for (let v = from; v < to; v += step) out.push(v);
  out.push(to);
  return out;
}

function buildTerrain(f: MapFrame, s: Surface): ChunkedGeometry {
  const chunkCols = Math.ceil(f.cols / T_CHUNK);
  const chunkRows = Math.ceil(f.rows / T_CHUNK);
  const acc = new SlotAccumulator(
    chunkCols * chunkRows,
    TERRAIN_LEVELS.map((l) => l.band),
    false,
    true,
  );
  const { cell } = f;
  const normalAt = (r: number, c: number): V3 => {
    const hE = s.corner(r, Math.min(f.cols, c + 1));
    const hW = s.corner(r, Math.max(0, c - 1));
    const hN = s.corner(Math.min(f.rows, r + 1), c);
    const hS = s.corner(Math.max(0, r - 1), c);
    // 世界法线：(-dh/dx, 1, +dh/dy)（世界 z = −y）
    const nx = -(hE - hW) / (2 * cell);
    const nz = (hN - hS) / (2 * cell);
    const len = Math.hypot(nx, 1, nz);
    return [nx / len, 1 / len, nz / len];
  };
  for (let cr = 0; cr < chunkRows; cr++) {
    for (let cc = 0; cc < chunkCols; cc++) {
      const k = cr * chunkCols + cc;
      const r0 = cr * T_CHUNK;
      const c0 = cc * T_CHUNK;
      const r1 = Math.min(f.rows, r0 + T_CHUNK);
      const c1 = Math.min(f.cols, c0 + T_CHUNK);
      TERRAIN_LEVELS.forEach(({ step }, level) => {
        const slot = acc.slot(k, level);
        const rs = steps(r0, r1, step);
        const cs = steps(c0, c1, step);
        const nc = cs.length;
        const top = (r: number, c: number): V3 => {
          const [wx, wz] = mapToWorld(f, c * cell, r * cell);
          return [wx, s.corner(r, c), wz];
        };
        for (const r of rs)
          for (const c of cs) acc.vertex(slot, top(r, c), normalAt(r, c));
        const idx = acc.idx![slot];
        for (let i = 0; i < rs.length - 1; i++) {
          for (let j = 0; j < nc - 1; j++) {
            const a = i * nc + j; // (r, c)
            const b = a + 1; // (r, c+1)
            const d = a + nc; // (r+1, c)
            const e = d + 1; // (r+1, c+1)
            // 与 Surface.heightAt 一致的对角线切分，俯视逆时针
            idx.push3(a, b, e);
            idx.push3(a, e, d);
          }
        }
        // 裙边：四条边各下沉 SKIRT 米，双面，遮挡相邻分块不同分辨率之间的裂缝
        const edges: [number, number][][] = [
          cs.map((c) => [r0, c]),
          cs.map((c) => [r1, c]),
          rs.map((r) => [r, c0]),
          rs.map((r) => [r, c1]),
        ];
        for (const edge of edges) {
          for (let i = 0; i < edge.length - 1; i++) {
            const [ra, ca] = edge[i];
            const [rb, cb] = edge[i + 1];
            const A = top(ra, ca);
            const B = top(rb, cb);
            const v0 = acc.pos[slot].len / 3;
            const na = normalAt(ra, ca);
            const nb = normalAt(rb, cb);
            acc.vertex(slot, A, na);
            acc.vertex(slot, B, nb);
            acc.vertex(slot, [B[0], B[1] - SKIRT, B[2]], nb);
            acc.vertex(slot, [A[0], A[1] - SKIRT, A[2]], na);
            idx.push3(v0, v0 + 1, v0 + 2);
            idx.push3(v0, v0 + 2, v0 + 3);
            idx.push3(v0, v0 + 2, v0 + 1);
            idx.push3(v0, v0 + 3, v0 + 2);
          }
        }
      });
    }
  }
  return acc.build();
}

function terrainTexture(f: MapFrame, terrain: string[][]): Uint8Array {
  const out = new Uint8Array(f.rows * f.cols * 4);
  const cache = new Map<string, [number, number, number]>();
  for (let r = 0; r < f.rows; r++) {
    const row = terrain[r];
    for (let c = 0; c < f.cols; c++) {
      const t = row[c];
      let col = cache.get(t);
      if (!col)
        cache.set(t, (col = rgb(TERRAIN_COLORS[t] ?? TERRAIN_COLORS.flat)));
      const o = (r * f.cols + c) * 4;
      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/* ------------------------------------------------------------- 建筑 */

function chunkOf(f: MapFrame, x: number, y: number, size: number) {
  const chunkCols = Math.ceil(f.cols / size);
  const chunkRows = Math.ceil(f.rows / size);
  const c = Math.min(f.cols - 1, Math.max(0, Math.floor(x / f.cell)));
  const r = Math.min(f.rows - 1, Math.max(0, Math.floor(y / f.cell)));
  return (
    Math.min(chunkRows - 1, Math.floor(r / size)) * chunkCols +
    Math.min(chunkCols - 1, Math.floor(c / size))
  );
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function bounds(ring: [number, number][]): Rect {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

const UP: V3 = [0, 1, 0];

/** 轴对齐盒体（顶面 + 四个侧面），地图局部坐标 → 世界坐标 */
function pushPrism(
  acc: SlotAccumulator,
  slot: number,
  f: MapFrame,
  r: Rect,
  base: number,
  top: number,
  color: V3,
) {
  const [wx0, wzS] = mapToWorld(f, r.x0, r.y0); // 西南
  const [wx1, wzN] = mapToWorld(f, r.x1, r.y1); // 东北（wzN < wzS）
  acc.face(
    slot,
    [
      [wx0, top, wzS],
      [wx1, top, wzS],
      [wx1, top, wzN],
      [wx0, top, wzN],
    ],
    UP,
    color,
  );
  acc.face(
    slot,
    [
      [wx0, base, wzS],
      [wx1, base, wzS],
      [wx1, top, wzS],
      [wx0, top, wzS],
    ],
    [0, 0, 1],
    color,
  );
  acc.face(
    slot,
    [
      [wx1, base, wzN],
      [wx0, base, wzN],
      [wx0, top, wzN],
      [wx1, top, wzN],
    ],
    [0, 0, -1],
    color,
  );
  acc.face(
    slot,
    [
      [wx1, base, wzS],
      [wx1, base, wzN],
      [wx1, top, wzN],
      [wx1, top, wzS],
    ],
    [1, 0, 0],
    color,
  );
  acc.face(
    slot,
    [
      [wx0, base, wzN],
      [wx0, base, wzS],
      [wx0, top, wzS],
      [wx0, top, wzN],
    ],
    [-1, 0, 0],
    color,
  );
}

/** 双坡屋顶：屋脊沿长边 */
function pushGable(
  acc: SlotAccumulator,
  slot: number,
  f: MapFrame,
  r: Rect,
  eave: number,
  rise: number,
  color: V3,
) {
  const P = (x: number, y: number, h: number): V3 => {
    const [wx, wz] = mapToWorld(f, x, y);
    return [wx, h, wz];
  };
  const ridge = eave + rise;
  if (r.x1 - r.x0 >= r.y1 - r.y0) {
    const ym = (r.y0 + r.y1) / 2;
    acc.face(
      slot,
      [
        P(r.x0, r.y0, eave),
        P(r.x1, r.y0, eave),
        P(r.x1, ym, ridge),
        P(r.x0, ym, ridge),
      ],
      [0, 1, 1],
      color,
    );
    acc.face(
      slot,
      [
        P(r.x1, r.y1, eave),
        P(r.x0, r.y1, eave),
        P(r.x0, ym, ridge),
        P(r.x1, ym, ridge),
      ],
      [0, 1, -1],
      color,
    );
    acc.face(
      slot,
      [P(r.x0, r.y1, eave), P(r.x0, r.y0, eave), P(r.x0, ym, ridge)],
      [-1, 0, 0],
      color,
    );
    acc.face(
      slot,
      [P(r.x1, r.y0, eave), P(r.x1, r.y1, eave), P(r.x1, ym, ridge)],
      [1, 0, 0],
      color,
    );
  } else {
    const xm = (r.x0 + r.x1) / 2;
    acc.face(
      slot,
      [
        P(r.x0, r.y0, eave),
        P(r.x0, r.y1, eave),
        P(xm, r.y1, ridge),
        P(xm, r.y0, ridge),
      ],
      [-1, 1, 0],
      color,
    );
    acc.face(
      slot,
      [
        P(r.x1, r.y1, eave),
        P(r.x1, r.y0, eave),
        P(xm, r.y0, ridge),
        P(xm, r.y1, ridge),
      ],
      [1, 1, 0],
      color,
    );
    acc.face(
      slot,
      [P(r.x0, r.y0, eave), P(r.x1, r.y0, eave), P(xm, r.y0, ridge)],
      [0, 0, 1],
      color,
    );
    acc.face(
      slot,
      [P(r.x1, r.y1, eave), P(r.x0, r.y1, eave), P(xm, r.y1, ridge)],
      [0, 0, -1],
      color,
    );
  }
}

/** 真实轮廓挤出（地标） */
function pushExtrude(
  acc: SlotAccumulator,
  slot: number,
  f: MapFrame,
  s: Surface,
  b: CityBuilding,
  color: V3,
) {
  const pts = b.footprint;
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: b.height,
    bevelEnabled: false,
  });
  const base = Math.min(...pts.map(([x, y]) => s.heightAt(x, y))) - 0.5;
  g.rotateX(-Math.PI / 2); // 形状 (x, y) → (x, 0, −y)，挤出方向 → +y
  g.translate(-f.width / 2, base, f.height / 2); // → 世界坐标
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const v0 = acc.pos[slot].len / 3;
  for (let i = 0; i < p.count; i++) {
    acc.vertex(
      slot,
      [p.getX(i), p.getY(i), p.getZ(i)],
      [n.getX(i), n.getY(i), n.getZ(i)],
      color,
    );
    acc.idx![slot].push1(v0 + i);
  }
  g.dispose();
}

/** 故宫：宫墙一圈 + 午门 + 太和殿（金色双坡顶），卡通识别件；尺寸取自真实外接矩形 */
function pushPalace(
  acc: SlotAccumulator,
  slot: number,
  f: MapFrame,
  s: Surface,
  r: Rect,
  red: V3,
) {
  const gold = rgb("#f2c14e", 0, true);
  const base =
    Math.min(
      s.heightAt(r.x0, r.y0),
      s.heightAt(r.x1, r.y0),
      s.heightAt(r.x0, r.y1),
      s.heightAt(r.x1, r.y1),
    ) - 0.5;
  const t = 18; // 宫墙厚
  const wall = base + 10;
  pushPrism(
    acc,
    slot,
    f,
    { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y0 + t },
    base,
    wall,
    red,
  );
  pushPrism(
    acc,
    slot,
    f,
    { x0: r.x0, y0: r.y1 - t, x1: r.x1, y1: r.y1 },
    base,
    wall,
    red,
  );
  pushPrism(
    acc,
    slot,
    f,
    { x0: r.x0, y0: r.y0, x1: r.x0 + t, y1: r.y1 },
    base,
    wall,
    red,
  );
  pushPrism(
    acc,
    slot,
    f,
    { x0: r.x1 - t, y0: r.y0, x1: r.x1, y1: r.y1 },
    base,
    wall,
    red,
  );
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  // 午门（南墙正中）
  const gate = { x0: cx - 60, y0: r.y0 - 4, x1: cx + 60, y1: r.y0 + 40 };
  pushPrism(acc, slot, f, gate, base, base + 20, red);
  pushGable(acc, slot, f, gate, base + 20, 10, gold);
  // 太和殿（略偏南的中轴线上）
  const hall = { x0: cx - 64, y0: cy - 120, x1: cx + 64, y1: cy - 54 };
  pushPrism(
    acc,
    slot,
    f,
    { x0: cx - 80, y0: cy - 140, x1: cx + 80, y1: cy - 34 },
    base,
    base + 6,
    rgb("#efe6d2", 0, true),
  );
  pushPrism(acc, slot, f, hall, base + 6, base + 26, red);
  pushGable(acc, slot, f, hall, base + 26, 16, gold);
}

/* ------------------------------------------------------------- ribbon（道路 / 水系） */

function pushRibbon(
  acc: SlotAccumulator,
  part: number,
  f: MapFrame,
  s: Surface,
  line: [number, number][],
  width: number,
  lift: number,
  color?: V3,
) {
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const nx = (-dy / len) * (width / 2);
    const ny = (dx / len) * (width / 2);
    const n = Math.max(1, Math.ceil(len / RIBBON_STEP));
    for (let t = 0; t < n; t++) {
      const x0 = ax + (dx * t) / n;
      const y0 = ay + (dy * t) / n;
      const x1 = ax + (dx * (t + 1)) / n;
      const y1 = ay + (dy * (t + 1)) / n;
      const slot = acc.slot(
        chunkOf(f, (x0 + x1) / 2, (y0 + y1) / 2, T_CHUNK),
        part,
      );
      const p = (x: number, y: number): V3 => {
        const [wx, wz] = mapToWorld(f, x, y);
        return [wx, s.heightAt(x, y) + lift, wz];
      };
      const A = p(x0 + nx, y0 + ny);
      const B = p(x0 - nx, y0 - ny);
      const C = p(x1 - nx, y1 - ny);
      const D = p(x1 + nx, y1 + ny);
      acc.face(slot, [A, B, C], UP, color);
      acc.face(slot, [A, C, D], UP, color);
    }
  }
}

function pushArea(
  acc: SlotAccumulator,
  f: MapFrame,
  s: Surface,
  poly: [number, number][],
) {
  const pts = poly.slice();
  if (
    pts.length > 1 &&
    pts[0][0] === pts[pts.length - 1][0] &&
    pts[0][1] === pts[pts.length - 1][1]
  )
    pts.pop();
  if (pts.length < 3) return;
  const contour = pts.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  let cx = 0;
  let cy = 0;
  let hs = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
    hs += s.heightAt(x, y);
  }
  cx /= pts.length;
  cy /= pts.length;
  const h = hs / pts.length + WATER_LIFT + 0.2;
  const slot = acc.slot(chunkOf(f, cx, cy, T_CHUNK), 0);
  for (const [a, b, c] of tris) {
    const w = [a, b, c].map((i): V3 => {
      const [wx, wz] = mapToWorld(f, pts[i][0], pts[i][1]);
      return [wx, h, wz];
    });
    acc.face(slot, w, UP);
  }
}

/* ------------------------------------------------------------- 主流程 */

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  if (ev.data.type !== "load") return;
  try {
    const { base, board } = ev.data;
    const T0 = performance.now();
    const timings: Record<string, number> = {};
    let tPrev = T0;
    const mark = (k: string) => {
      const now = performance.now();
      timings[k] = Math.round(now - tPrev);
      tPrev = now;
    };
    const [parcel, bData, nData, lData] = (await fetchAll(base, [
      "parcel.json",
      "buildings.json",
      "network.json",
      "labels.json",
    ])) as [
      {
        grid: { rows: number; cols: number; cell_m: number };
        bbox_wgs84: FullMapData["bbox"];
        terrain: string[][];
        elevation: number[][];
      },
      FullBuildingsFile,
      {
        roads: { kind: string; line: [number, number][] }[];
        water: {
          kind: string;
          line?: [number, number][];
          footprint?: [number, number][];
        }[];
      },
      {
        labels: {
          name: string;
          kind: string;
          pos: [number, number];
          importance: number;
        }[];
      },
    ];

    mark("download+parse");
    const f = mapFrame(parcel.grid);
    // 可玩沙盘所在矩形：其中的普通 / 功能建筑不绘制，地标进 boardLandmark 部件（由主线程决定是否显示）
    const anchor = board ? boardAnchorOnMap(parcel.bbox_wgs84, board) : null;
    const boardRect = anchor
      ? {
          x0: anchor.x - anchor.half,
          y0: anchor.y - anchor.half,
          x1: anchor.x + anchor.half,
          y1: anchor.y + anchor.half,
        }
      : null;
    const inBoard = (x: number, y: number) =>
      !!boardRect &&
      x >= boardRect.x0 &&
      x <= boardRect.x1 &&
      y >= boardRect.y0 &&
      y <= boardRect.y1;

    progress("terrain", 0);
    const elevation = new Float32Array(f.rows * f.cols);
    for (let r = 0; r < f.rows; r++)
      elevation.set(parcel.elevation[r], r * f.cols);
    const surface = new Surface(f, elevation);
    const terrain = buildTerrain(f, surface);
    const terrainRGBA = terrainTexture(f, parcel.terrain);
    mark("terrain");
    progress("terrain", 1);

    // 建筑：统一模型（去重地标）→ 按格索引 + 紧凑表 + LOD 分槽几何
    const list = normalizeBuildings(bData);
    const cellIndex = buildCellIndex(list, f.rows, f.cols);
    const table = toBuildingTable(list);
    const bChunks = Math.ceil(f.cols / B_CHUNK) * Math.ceil(f.rows / B_CHUNK);
    const bAcc = new SlotAccumulator(bChunks, BUILDING_BANDS, true, true);
    const landmarks: MapLandmark[] = [];
    const landmarkHeight = new Map<string, number>();
    const roofPitched = rgb(TOON_ROOF_COLORS.pitched, 0, true);
    const roofRural = rgb(TOON_ROOF_COLORS.rural, 0, true);
    const roofMachine = rgb(TOON_ROOF_COLORS.machine, 0, true);
    let hidden = 0;
    let urban = 0;
    let rural = 0;
    let village: [number, number] | null = null;
    // 故宫院内：真实殿宇在数据包里是 140m 方盒（功能建筑占格），改画成「红墙金顶」小殿，每格一座
    const palace = list.find((b) => b.landmark === "gugong");
    const palaceRect = palace ? bounds(palace.footprint) : null;
    const palaceCells = new Set<number>();
    const palaceRed = rgb("#d8574a", 0, true);
    const palaceGold = rgb("#f2c14e", 0, true);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.settlement === "urban") urban++;
      if (b.settlement === "rural") {
        rural++;
        if (!village) village = b.center;
      }
      const [cx, cy] = b.center;
      const board = inBoard(cx, cy);
      const k = chunkOf(f, cx, cy, B_CHUNK);
      const color = rgb(buildingColor(b), 0, true);
      if (b.kind === "landmark") {
        const part = board
          ? BUILDING_PART.boardLandmark
          : BUILDING_PART.landmark;
        if (b.landmark === "gugong")
          pushPalace(
            bAcc,
            bAcc.slot(k, part),
            f,
            surface,
            bounds(b.footprint),
            color,
          );
        else pushExtrude(bAcc, bAcc.slot(k, part), f, surface, b, color);
        if (b.landmark && !landmarks.some((l) => l.key === b.landmark))
          landmarks.push({
            key: b.landmark,
            name: b.name ?? b.landmark,
            x: cx,
            y: cy,
            height: b.height,
          });
        if (b.name)
          landmarkHeight.set(
            b.name,
            Math.max(landmarkHeight.get(b.name) ?? 0, b.height),
          );
        continue;
      }
      if (board) {
        hidden++;
        continue;
      }
      const r = bounds(b.footprint);
      if (
        palaceRect &&
        cx > palaceRect.x0 &&
        cx < palaceRect.x1 &&
        cy > palaceRect.y0 &&
        cy < palaceRect.y1
      ) {
        const cellKey =
          Math.floor(cy / f.cell) * f.cols + Math.floor(cx / f.cell);
        if (palaceCells.has(cellKey)) continue;
        palaceCells.add(cellKey);
        const mx = (r.x0 + r.x1) / 2;
        const my = (r.y0 + r.y1) / 2;
        const hall = { x0: mx - 34, y0: my - 22, x1: mx + 34, y1: my + 22 };
        const g = surface.heightAt(mx, my) - 0.5;
        pushPrism(
          bAcc,
          bAcc.slot(k, BUILDING_PART.base),
          f,
          hall,
          g,
          g + 9,
          palaceRed,
        );
        pushGable(
          bAcc,
          bAcc.slot(k, BUILDING_PART.base),
          f,
          hall,
          g + 9,
          8,
          palaceGold,
        );
        continue;
      }
      // 底面压到四角最低地表下 0.5m：坡地上不悬空
      const base =
        Math.min(
          surface.heightAt(r.x0, r.y0),
          surface.heightAt(r.x1, r.y0),
          surface.heightAt(r.x0, r.y1),
          surface.heightAt(r.x1, r.y1),
        ) - 0.5;
      const top = base + b.height;
      pushPrism(bAcc, bAcc.slot(k, BUILDING_PART.base), f, r, base, top, color);
      if (b.height >= SIMPLE_MIN_HEIGHT)
        pushPrism(
          bAcc,
          bAcc.slot(k, BUILDING_PART.simple),
          f,
          r,
          base,
          top,
          color,
        );
      const w = r.x1 - r.x0;
      const d = r.y1 - r.y0;
      const inset = (t: number): Rect => ({
        x0: r.x0 + w * t,
        y0: r.y0 + d * t,
        x1: r.x1 - w * t,
        y1: r.y1 - d * t,
      });
      if (b.height >= 24) {
        // 中模：高层屋顶机房
        const h = Math.min(12, Math.max(3, b.height * 0.06));
        pushPrism(
          bAcc,
          bAcc.slot(k, BUILDING_PART.mid),
          f,
          inset(0.3),
          top - 0.2,
          top + h,
          roofMachine,
        );
      } else if (
        b.height <= 12 &&
        (b.category === "res_low" || b.settlement === "rural")
      ) {
        // 精细：低层坡屋顶
        const rise = Math.min(6, 0.25 * Math.min(w, d));
        pushGable(
          bAcc,
          bAcc.slot(k, BUILDING_PART.fine),
          f,
          r,
          top - 0.05,
          rise,
          b.settlement === "rural" ? roofRural : roofPitched,
        );
      } else {
        // 精细：多层屋顶小件
        pushPrism(
          bAcc,
          bAcc.slot(k, BUILDING_PART.fine),
          f,
          inset(0.36),
          top - 0.2,
          top + 2.5,
          roofMachine,
        );
      }
      if (i % 4000 === 0) progress("buildings", i / list.length);
    }
    const buildings = bAcc.build();
    mark("buildings");
    progress("buildings", 1);

    // 道路（3 档）/ 水系
    const tChunks = Math.ceil(f.cols / T_CHUNK) * Math.ceil(f.rows / T_CHUNK);
    const rAcc = new SlotAccumulator(tChunks, ROAD_TIER_BAND, true, false);
    const tierColor = ROAD_TIER_COLOR.map((c) => rgb(c, 0, true));
    nData.roads.forEach((road, i) => {
      const tier = roadTier(road.kind);
      pushRibbon(
        rAcc,
        tier,
        f,
        surface,
        road.line,
        ROAD_TIER_W[tier],
        ROAD_LIFT + tier * -0.1,
        tierColor[tier],
      );
      if (i % 5000 === 0) progress("network", (i / nData.roads.length) * 0.7);
    });
    const roads = rAcc.build();
    const wAcc = new SlotAccumulator(tChunks, [[0, FAR]], false, false);
    for (const w of nData.water ?? []) {
      if (w.footprint) pushArea(wAcc, f, surface, w.footprint);
      else if (w.line)
        pushRibbon(
          wAcc,
          0,
          f,
          surface,
          w.line,
          WATER_W[w.kind] ?? 16,
          WATER_LIFT,
        );
    }
    const water = wAcc.build();
    mark("network");
    progress("network", 1);

    // 标签：importance ≥3，名称 + 1km 网格去重；地标高度 Map 查表
    const seen = new Set<string>();
    const labels: MapLabel[] = [];
    for (const l of lData.labels) {
      if (l.importance < 3 || !l.name) continue;
      const key = `${l.name}|${Math.round(l.pos[0] / 1000)}|${Math.round(l.pos[1] / 1000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lh = landmarkHeight.get(l.name);
      const ground = surface.heightAt(l.pos[0], l.pos[1]);
      const [wx, wz] = mapToWorld(f, l.pos[0], l.pos[1]);
      labels.push({
        name: l.name,
        importance: l.importance,
        kind: l.kind,
        x: wx,
        y: lh !== undefined ? ground + lh + 120 : ground + 160,
        z: wz,
      });
    }
    labels.sort((a, b) => b.importance - a.importance);
    mark("labels");
    timings.total = Math.round(performance.now() - T0);
    progress("labels", 1);

    const data: FullMapData = {
      grid: parcel.grid,
      bbox: parcel.bbox_wgs84,
      elevation,
      terrainRGBA,
      terrain,
      buildings,
      cellIndex,
      table,
      boardRect,
      roads,
      water,
      labels,
      landmarks,
      village,
      stats: {
        buildings: list.length,
        landmarkDuplicatesRemoved: bData.buildings.length - list.length,
        triangles: {
          terrain: triangles(terrain),
          buildings: triangles(buildings),
          roads: triangles(roads),
          water: triangles(water),
        },
        urban,
        rural,
        roads: nData.roads.length,
        labels: lData.labels.length,
        hiddenUnderBoard: hidden,
        timings,
      },
    };
    const transfer: Transferable[] = [
      elevation.buffer,
      terrainRGBA.buffer,
      cellIndex.buffer,
      table.cx.buffer,
      table.cy.buffer,
      table.height.buffer,
      table.area.buffer,
      table.bbox.buffer,
      table.category.buffer,
      table.kind.buffer,
      table.landmark.buffer,
    ] as Transferable[];
    for (const g of [terrain, buildings, roads, water]) {
      for (const a of [
        g.position,
        g.normal,
        g.chunks,
        g.boxes,
        g.bands,
        g.parts,
        g.color,
        g.index,
      ])
        if (a) transfer.push(a.buffer as ArrayBuffer);
    }
    post({ type: "done", data }, transfer);
  } catch (e) {
    post({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
