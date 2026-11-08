/**
 * 「CITY20 Pixel 24」统一色板（16 §3，取代 11 §6.0 卡通色板）。
 * UI（globals.css 的 --px-* 变量）与 3D 场景（three.js 材质 / 顶点色）共用这里的十六进制值；
 * 组件与场景代码不再写裸色值。tests/palette.test.ts 校验 CSS 变量与本文件一致。
 */
import type { Terrain } from "./contract";
import type { TileCategory } from "./catalog";

/** UI 基础色（16 §3.1），键名 = CSS 变量名去掉 `--px-` 前缀 */
export const PX = {
  ink: "#2A2340",
  "ink-soft": "#5B5277",
  paper: "#FFF8E7",
  "paper-2": "#F6E3B8",
  "paper-4": "#E2C48A",
  "paper-shade": "#F0D9A6",
  sky: "#C6ECFF",
  "sky-4": "#7CCBFF",
  ok: "#3CCB6E",
  bad: "#FF4F5E",
  warn: "#FFB020",
  sun: "#FFC93C",
  "sun-light": "#FFE07A",
  "sun-dark": "#E0A21F",
  orange: "#FF8A3D",
  grape: "#9D7BFF",
  mint: "#3DD68C",
  berry: "#FF5C7A",
  "berry-dark": "#D93D5C",
  blue: "#3D8BFF",
  slate: "#8A97B4",
  "tint-sun": "#FFF3C4",
  "tint-blue": "#DCEBFF",
  "tint-mint": "#DFFBEA",
  "tint-berry": "#FFE0E6",
  "tint-grape": "#E8E0FF",
} as const;

/** 地形顶面色（16 §3.3）：flat 草绿 / occupied 沙色 / river 河床 / bank 浅水 / forest 深草 / road 沥青 */
export const TERRAIN_COLORS: Record<Terrain, string> = {
  flat: "#9BDE6E",
  hill: "#D6B97A",
  river: "#46B4F2",
  bank: "#9EE3FF",
  forest: "#77C25A",
  road_inherited: "#6B6F8E",
  occupied: "#F3E2B3",
};

/** 棋盘格交错的第二色（±4% 明度），出像素地砖感 */
export const TERRAIN_ALT_COLORS: Record<Terrain, string> = {
  flat: "#93D766",
  hill: "#CFB172",
  river: "#40ACEB",
  bank: "#94DCFA",
  forest: "#70BA54",
  road_inherited: "#6B6F8E",
  occupied: "#EEDBA8",
};

/** 玩家建筑大类主色 = UI 卡牌分类色（16 §3.2） */
export const CATEGORY_COLORS: Record<TileCategory, string> = {
  residential: PX.sun,
  commercial: PX.orange,
  industrial: PX.grape,
  green: PX.mint,
  service: PX.berry,
  transport: PX.blue,
  utility: PX.slate,
};

/** 玩家建筑三面色：m 墙（亮侧）/ d 墙（暗侧）/ t 顶面 / w 窗 */
export interface FaceColors {
  m: string;
  d: string;
  t: string;
  w: string;
}

export const CATEGORY_FACES: Record<TileCategory, FaceColors> = {
  residential: { m: "#FFC93C", d: "#E0A21F", t: "#FFE07A", w: "#FFF3C4" },
  commercial: { m: "#FF8A3D", d: "#D9652A", t: "#FFB074", w: "#FFE2C8" },
  industrial: { m: "#9D7BFF", d: "#7B5BE0", t: "#C4B2FF", w: "#E8E0FF" },
  green: { m: "#3DD68C", d: "#22B06D", t: "#8EF0BF", w: "#DFFBEA" },
  service: { m: "#FF5C7A", d: "#D93D5C", t: "#FF9AAE", w: "#FFE0E6" },
  transport: { m: "#3D8BFF", d: "#2266D6", t: "#8CBCFF", w: "#DCEBFF" },
  utility: { m: "#8A97B4", d: "#6B7896", t: "#B7C1D6", w: "#E3E8F2" },
};

/**
 * 既有真实建筑（16 §3.4）：分类色的浅色版，墙 / 屋顶分色——真实城市是浅色底景。
 * civic 是 OSM 管线的兜底类（北京 CBD 数据包里约占 9 成），用中性奶油色，避免整城被一种色相淹没。
 */
export const EXISTING_FACES: Record<"residential" | "workplace" | "industrial" | "civic", FaceColors> = {
  residential: { m: "#FFE7B0", d: "#EDCB88", t: "#FFC9A8", w: "#E2C08A" },
  workplace: { m: "#CFE7FF", d: "#A9CDF2", t: "#A9D8FF", w: "#8FB8E6" },
  industrial: { m: "#E2DAFF", d: "#C6BAF0", t: "#CFC4FF", w: "#B3A6E6" },
  civic: { m: "#FFF1D6", d: "#EBD5AE", t: "#FFFAEE", w: "#E2C48A" },
};

/** 场景辅助色 */
export const SCENE_COLORS = {
  background: PX.sky,
  /** 底座剖面：顶边草皮 / 泥土 / 深层泥土 */
  plinthGrass: "#77C25A",
  plinth: "#A8683F",
  plinthDeep: "#7A4A2E",
  riverbed: "#2F86C9",
  water: "#46B4F2",
  existingBuilding: EXISTING_FACES.workplace.m,
  trunk: "#A8683F",
  treeCrown: "#4FC064",
  grid: PX.ink,
  hover: PX.sun,
  valid: PX.ok,
  invalid: PX.bad,
  accentLight: PX.paper,
  accentDark: PX.ink,
  asphalt: "#6B6F8E",
  curb: "#A7ABC6",
  rail: PX.grape,
  roof: PX.orange,
  roofDark: "#D9652A",
  track: "#E0664F",
  trackInner: "#7FD18C",
  glass: "#8CBCFF",
  outline: PX.ink,
  /** 半球光：天空白、地面草绿反光 */
  hemiSky: "#FFFFFF",
  hemiGround: "#D9F0C8",
} as const;
