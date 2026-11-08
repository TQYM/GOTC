/**
 * 统一城市建筑模型（PR-36）。
 *
 * 两份数据包的建筑格式不同，渲染层只认这里的 CityBuilding：
 * - beijing_full/buildings.json：`{ buildings: [{ id, name, kind, category, height_m, footprint, cells, center }] }`
 *   （全域 940×813 格 @200m，kind = generated / functional / landmark）
 * - beijing_cbd/buildings.json：`{ chunks: { "r:c": ExistingAsset[] } }`（CBD 48×48 格 @50m，既有建筑）
 *
 * 坐标一律是各自数据包的局部米制坐标（x 东、y 北，原点 = bbox 西南角），cells 为 [row, col]。
 * 本模块只做格式归一、去重、配色与按格索引，不改数据文件、不触碰后端契约。
 */
import type { BuildingsFile, ExistingAsset } from "./types";

export type BuildingKind = "existing" | "generated" | "functional" | "landmark";
export type LandmarkKey = "zun" | "cctv" | "gugong" | "niaochao" | "watercube";
export type ServiceKind = "school" | "hospital";

export interface CityBuilding {
  id: string;
  name: string | null;
  kind: BuildingKind;
  /** 全域：res_low / res_mid / res_high / shop / cbd / light_industry / school / hospital / landmark；
   *  CBD：residential / workplace / industrial / civic */
  category: string;
  landmark: LandmarkKey | null;
  settlement: "urban" | "rural" | null;
  /** 高度（米），已兜底为 ≥2 */
  height: number;
  /** 开口环（去掉与首点重复的尾点），局部米制 [x, y] */
  footprint: [number, number][];
  cells: [number, number][];
  center: [number, number];
}

/** beijing_full 单条建筑记录 */
export interface FullBuildingRecord {
  id: string;
  name?: string | null;
  kind: "generated" | "functional" | "landmark";
  category: string;
  landmark?: string;
  settlement?: "urban" | "rural";
  height_m: number;
  footprint: [number, number][];
  cells: [number, number][];
  center: [number, number];
}

export interface FullBuildingsFile {
  buildings: FullBuildingRecord[];
}

export type AnyBuildingsFile = FullBuildingsFile | BuildingsFile;

export function isFullBuildingsFile(file: unknown): file is FullBuildingsFile {
  return (
    !!file &&
    typeof file === "object" &&
    Array.isArray((file as { buildings?: unknown }).buildings)
  );
}

export function isChunkedBuildingsFile(file: unknown): file is BuildingsFile {
  const chunks = (file as { chunks?: unknown } | null)?.chunks;
  return !!chunks && typeof chunks === "object" && !Array.isArray(chunks);
}

const LANDMARK_KEYS: readonly LandmarkKey[] = [
  "zun",
  "cctv",
  "gugong",
  "niaochao",
  "watercube",
];

/** 地标识别：优先数据自带的 landmark 键，其次按真实名称（CBD 包里中国尊 / 央视是普通既有建筑） */
const LANDMARK_NAMES: [RegExp, LandmarkKey][] = [
  [/^中国尊$|中信大厦/, "zun"],
  [/中央电视台总部|^央视大楼|CCTV/i, "cctv"],
  [/^故宫$|故宫博物院/, "gugong"],
  [/^国家体育场|鸟巢/, "niaochao"],
  [/国家游泳中心|水立方/, "watercube"],
];

export function landmarkOf(
  key: unknown,
  name: string | null,
): LandmarkKey | null {
  if (
    typeof key === "string" &&
    (LANDMARK_KEYS as readonly string[]).includes(key)
  )
    return key as LandmarkKey;
  if (!name) return null;
  for (const [re, k] of LANDMARK_NAMES) if (re.test(name)) return k;
  return null;
}

function cleanRing(
  points: readonly (readonly number[])[] | undefined,
): [number, number][] {
  const out: [number, number][] = [];
  if (!Array.isArray(points)) return out;
  for (const p of points) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
      continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const [a, b] = [out[0], out[out.length - 1]];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}

export function ringCentroid(
  ring: readonly [number, number][],
): [number, number] {
  if (ring.length === 0) return [0, 0];
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) {
    x += px;
    y += py;
  }
  return [x / ring.length, y / ring.length];
}

/** 多边形面积（鞋带公式，m²） */
export function ringArea(ring: readonly [number, number][]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

function safeHeight(h: unknown, levels?: unknown): number {
  if (typeof h === "number" && Number.isFinite(h) && h > 0)
    return Math.max(2, h);
  if (typeof levels === "number" && Number.isFinite(levels) && levels > 0)
    return Math.max(3, levels * 3.2);
  return 6;
}

function fromFull(r: FullBuildingRecord): CityBuilding | null {
  const footprint = cleanRing(r.footprint);
  if (footprint.length < 3) return null;
  const name = r.name ? String(r.name) : null;
  const landmark = landmarkOf(r.landmark, r.kind === "landmark" ? name : null);
  return {
    id: String(r.id),
    name,
    kind:
      r.kind === "landmark" || landmark
        ? "landmark"
        : r.kind === "functional"
          ? "functional"
          : "generated",
    category: r.category,
    landmark,
    settlement: r.settlement ?? null,
    height: safeHeight(r.height_m),
    footprint,
    cells: Array.isArray(r.cells) ? r.cells : [],
    center:
      Array.isArray(r.center) &&
      Number.isFinite(r.center[0]) &&
      Number.isFinite(r.center[1])
        ? [r.center[0], r.center[1]]
        : ringCentroid(footprint),
  };
}

function fromExisting(a: ExistingAsset): CityBuilding | null {
  const footprint = cleanRing(a.footprint);
  if (footprint.length < 3) return null;
  const name = a.name ? String(a.name) : null;
  const landmark = landmarkOf(null, name);
  return {
    id: a.asset_id,
    name,
    kind: landmark ? "landmark" : "existing",
    category: a.category,
    landmark,
    settlement: "urban",
    height: safeHeight(a.height_m, a.levels),
    footprint,
    cells: Array.isArray(a.cells) ? a.cells : [],
    center: ringCentroid(footprint),
  };
}

/**
 * 同名地标只保留一份（故宫在全域包里有 5 条同名记录）：保留占地最大的那条，
 * 其余部件的格子并入，保证按格拾取仍能命中；若所有部件的整体外接矩形远大于最大部件
 * （故宫的部件是破碎的宫墙线），改用整体外接矩形作为轮廓。
 */
export function dedupeLandmarks(list: CityBuilding[]): CityBuilding[] {
  const best = new Map<string, CityBuilding>();
  const cells = new Map<string, [number, number][]>();
  for (const b of list) {
    if (b.kind !== "landmark") continue;
    const key = b.name ?? b.landmark ?? b.id;
    const cur = best.get(key);
    if (!cur || ringArea(b.footprint) > ringArea(cur.footprint))
      best.set(key, b);
    const acc = cells.get(key) ?? [];
    for (const c of b.cells)
      if (!acc.some((d) => d[0] === c[0] && d[1] === c[1])) acc.push(c);
    cells.set(key, acc);
  }
  // 同名部件的整体外接矩形：部件本身多是破碎的边墙（故宫），外接矩形远大于最大部件时改用外接矩形
  const extent = new Map<string, [number, number, number, number]>();
  for (const b of list) {
    if (b.kind !== "landmark") continue;
    const key = b.name ?? b.landmark ?? b.id;
    const e = extent.get(key) ?? [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of b.footprint) {
      e[0] = Math.min(e[0], x);
      e[1] = Math.min(e[1], y);
      e[2] = Math.max(e[2], x);
      e[3] = Math.max(e[3], y);
    }
    extent.set(key, e);
  }
  const out: CityBuilding[] = [];
  for (const b of list) {
    if (b.kind !== "landmark") {
      out.push(b);
      continue;
    }
    const key = b.name ?? b.landmark ?? b.id;
    if (best.get(key) !== b) continue;
    const [x0, y0, x1, y1] = extent.get(key)!;
    const rect: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    const useRect = ringArea(rect) > 4 * ringArea(b.footprint);
    out.push({
      ...b,
      footprint: useRect ? rect : b.footprint,
      center: useRect ? [(x0 + x1) / 2, (y0 + y1) / 2] : b.center,
      cells: cells.get(key) ?? b.cells,
    });
  }
  return out;
}

/**
 * 两种格式 → CityBuilding[]（已去掉更新改造中的既有建筑、已做地标去重）。
 * 未知格式返回空数组而不是抛错：渲染层降级为只画地形。
 */
export function normalizeBuildings(
  file: unknown,
  redevelopedAssetIds: Iterable<string> = [],
): CityBuilding[] {
  const out: CityBuilding[] = [];
  if (isFullBuildingsFile(file)) {
    for (const r of file.buildings) {
      const b = fromFull(r);
      if (b) out.push(b);
    }
  } else if (isChunkedBuildingsFile(file)) {
    const skip = new Set(redevelopedAssetIds);
    for (const assets of Object.values(file.chunks)) {
      if (!Array.isArray(assets)) continue;
      for (const a of assets) {
        if (skip.has(a.asset_id)) continue;
        const b = fromExisting(a);
        if (b) out.push(b);
      }
    }
  }
  return dedupeLandmarks(out);
}

/* ------------------------------------------------------------- 卡通配色 */

/** 粉彩灰白基调：普通建筑只带极轻的类别色偏，地标 / 学校医院才用强调色 */
export const TOON_BUILDING_COLORS: Record<string, string> = {
  // 全域生成 / 功能建筑
  res_low: "#f3efe8",
  res_mid: "#ecebe6",
  res_high: "#e6e9ee",
  shop: "#f4ebe0",
  cbd: "#e2e8f1",
  light_industry: "#e8e4ec",
  school: "#bfe6d6",
  hospital: "#f6cfc8",
  // CBD 既有建筑
  residential: "#efede8",
  workplace: "#e5e8ee",
  industrial: "#e6e2dc",
  civic: "#ebe6dc",
};

export const TOON_LANDMARK_COLORS: Record<LandmarkKey, string> = {
  zun: "#f2c14e", // 中国尊：金
  cctv: "#ff8a3d", // 央视大楼：橙
  gugong: "#d8574a", // 故宫：宫墙红
  niaochao: "#c8ced6", // 鸟巢：钢灰
  watercube: "#7cc6ef", // 水立方：水蓝
};

/** 屋顶细节（坡屋顶 / 机房）配色 */
export const TOON_ROOF_COLORS = {
  pitched: "#d99a7a",
  rural: "#c98f74",
  machine: "#d6d8dc",
} as const;

export function buildingColor(
  b: Pick<CityBuilding, "landmark" | "category">,
): string {
  if (b.landmark) return TOON_LANDMARK_COLORS[b.landmark];
  return TOON_BUILDING_COLORS[b.category] ?? "#ebe9e4";
}

export function serviceKind(
  b: Pick<CityBuilding, "category">,
): ServiceKind | null {
  return b.category === "school"
    ? "school"
    : b.category === "hospital"
      ? "hospital"
      : null;
}

/* ------------------------------------------------------------- 按格索引（拾取用） */

/**
 * rows×cols 行主序：格 → 建筑下标（-1 = 空）。同格多栋时取更重要的：
 * 地标 > 学校医院 > 其它功能建筑 > 更高的建筑。拾取只查表，不对 7 万栋建筑做射线求交。
 */
export function buildCellIndex(
  list: readonly CityBuilding[],
  rows: number,
  cols: number,
): Int32Array {
  const idx = new Int32Array(rows * cols).fill(-1);
  const rank = (b: CityBuilding) =>
    (b.kind === "landmark" ? 3e6 : 0) +
    (serviceKind(b) ? 2e6 : 0) +
    (b.kind === "functional" ? 1e6 : 0) +
    b.height;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    for (const cell of b.cells) {
      const [r, c] = cell;
      if (
        !Number.isInteger(r) ||
        !Number.isInteger(c) ||
        r < 0 ||
        c < 0 ||
        r >= rows ||
        c >= cols
      )
        continue;
      const o = r * cols + c;
      const cur = idx[o];
      if (cur < 0 || rank(b) > rank(list[cur])) idx[o] = i;
    }
  }
  return idx;
}

/** 局部坐标 → 格（行自南向北）；越界返回 null */
export function mapPointToCell(
  x: number,
  y: number,
  rows: number,
  cols: number,
  cellM: number,
): [number, number] | null {
  const r = Math.floor(y / cellM);
  const c = Math.floor(x / cellM);
  if (
    !Number.isFinite(r) ||
    !Number.isFinite(c) ||
    r < 0 ||
    c < 0 ||
    r >= rows ||
    c >= cols
  )
    return null;
  return [r, c];
}

/* ------------------------------------------------------------- 紧凑建筑表（worker → 主线程） */

/** 类别编码：worker 用类型化数组把 7 万栋建筑的拾取 / 面板信息零拷贝传回主线程 */
export const CATEGORY_CODES = [
  "res_low",
  "res_mid",
  "res_high",
  "shop",
  "cbd",
  "light_industry",
  "school",
  "hospital",
  "landmark",
  "residential",
  "workplace",
  "industrial",
  "civic",
  "other",
] as const;
export const KIND_CODES: readonly BuildingKind[] = [
  "existing",
  "generated",
  "functional",
  "landmark",
];

export interface BuildingTable {
  count: number;
  cx: Float32Array;
  cy: Float32Array;
  height: Float32Array;
  area: Float32Array;
  /** 轮廓外接矩形 [x0, y0, x1, y1]（选中高亮用） */
  bbox: Float32Array;
  category: Uint8Array;
  kind: Uint8Array;
  /** 0 = 非地标，否则 LANDMARK_KEYS 下标 + 1 */
  landmark: Uint8Array;
  /** 稀疏：只存有名字的建筑 */
  names: Record<number, string>;
  ids: Record<number, string>;
}

export function toBuildingTable(list: readonly CityBuilding[]): BuildingTable {
  const n = list.length;
  const t: BuildingTable = {
    count: n,
    cx: new Float32Array(n),
    cy: new Float32Array(n),
    height: new Float32Array(n),
    area: new Float32Array(n),
    bbox: new Float32Array(n * 4),
    category: new Uint8Array(n),
    kind: new Uint8Array(n),
    landmark: new Uint8Array(n),
    names: {},
    ids: {},
  };
  const other = CATEGORY_CODES.indexOf("other");
  for (let i = 0; i < n; i++) {
    const b = list[i];
    t.cx[i] = b.center[0];
    t.cy[i] = b.center[1];
    t.height[i] = b.height;
    t.area[i] = ringArea(b.footprint);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of b.footprint) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    t.bbox.set([x0, y0, x1, y1], i * 4);
    const c = (CATEGORY_CODES as readonly string[]).indexOf(b.category);
    t.category[i] = c < 0 ? other : c;
    t.kind[i] = KIND_CODES.indexOf(b.kind);
    t.landmark[i] = b.landmark ? LANDMARK_KEYS.indexOf(b.landmark) + 1 : 0;
    if (b.name) {
      t.names[i] = b.name;
      t.ids[i] = b.id;
    }
  }
  return t;
}

export interface BuildingInfo {
  index: number;
  id: string | null;
  name: string | null;
  kind: BuildingKind;
  category: string;
  landmark: LandmarkKey | null;
  height: number;
  footprintM2: number;
  center: [number, number];
}

export function buildingInfo(t: BuildingTable, i: number): BuildingInfo | null {
  if (!Number.isInteger(i) || i < 0 || i >= t.count) return null;
  return {
    index: i,
    id: t.ids[i] ?? null,
    name: t.names[i] ?? null,
    kind: KIND_CODES[t.kind[i]] ?? "generated",
    category: CATEGORY_CODES[t.category[i]] ?? "other",
    landmark: t.landmark[i] ? LANDMARK_KEYS[t.landmark[i] - 1] : null,
    height: t.height[i],
    footprintM2: Math.round(t.area[i]),
    center: [t.cx[i], t.cy[i]],
  };
}

/* ------------------------------------------------------------- 学校 / 医院本地面板 */

export interface ServiceSummary {
  kind: ServiceKind;
  /** 服务半径（米）：学校 1km（15 分钟生活圈步行），医院 3km */
  radius: number;
  /** 半径内住宅建筑栋数 */
  homes: number;
  /** 半径内同类设施数（不含自身） */
  peers: number;
}

const RESIDENTIAL_CODES = new Set(
  ["res_low", "res_mid", "res_high", "residential"].map((c) =>
    (CATEGORY_CODES as readonly string[]).indexOf(c),
  ),
);

/** 学校 / 医院详情的本地版本（建筑详情接口未实现，只用前端已加载的数据粗算，不当作指标） */
export function serviceSummary(
  t: BuildingTable,
  i: number,
): ServiceSummary | null {
  const info = buildingInfo(t, i);
  const kind = info ? serviceKind(info) : null;
  if (!info || !kind) return null;
  const radius = kind === "school" ? 1000 : 3000;
  const r2 = radius * radius;
  const [cx, cy] = info.center;
  const cat = t.category[i];
  let homes = 0;
  let peers = 0;
  for (let j = 0; j < t.count; j++) {
    const dx = t.cx[j] - cx;
    const dy = t.cy[j] - cy;
    if (dx * dx + dy * dy > r2) continue;
    if (RESIDENTIAL_CODES.has(t.category[j])) homes++;
    else if (j !== i && t.category[j] === cat) peers++;
  }
  return { kind, radius, homes, peers };
}
