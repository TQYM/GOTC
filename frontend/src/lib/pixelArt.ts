/**
 * 像素美术（16 §4.3）：零图片资源。
 * - `iconLayers`：16×16 功能图标，行用游程写法（`"3. k 10a k 2."` = 3 个空、1 个 k、10 个 a…）；
 * - `tileLayers`：14 种区块的等距像素缩略图，由一个极小的软件光栅器绘制，
 *   造型与 3D 模型（tileModels.ts）一一对应，颜色取自统一色板。
 * 两者都输出「每种颜色一条 SVG path」，由 <PixelSprite> 以 crispEdges 渲染。
 */
import type { TileType } from "./contract";
import { TILE_SPECS } from "./catalog";
import { CATEGORY_FACES, PX, SCENE_COLORS, type FaceColors } from "./palette";

export interface SpriteLayer {
  c: string;
  d: string;
}
export interface Sprite {
  w: number;
  h: number;
  layers: SpriteLayer[];
}

/* ------------------------------------------------------------------ 图标 */

interface IconDef {
  c: Record<string, string>;
  r: string[];
}

const ICONS = {
  build: { c: { a: "#FF8A3D", d: "#D9652A", m: "#FFF8E7", l: "#7CCBFF" }, r: [
    "16.", "7. 2k 7.", "6. kaak 6.", "5. k 4a k 5.", "4. k 6a k 4.", "3. k 8a k 3.", "2. k 10a k 2.", ". k 12d k .",
    "2. k 10m k 2.", "2. kmkkkmmkkkmk 2.", "2. kmklkmmkdkmk 2.", "2. kmkkkmmkdkmk 2.", "2. kmmmmmmkdkmk 2.", "2. 12k 2.", "16.", "16."] },
  remove: { c: { l: "#FFFFFF", m: "#C9CCDA", d: "#8A97B4", a: "#E0A060", e: "#A8683F" }, r: [
    "16.", ". 14k .", ". k 10l mm k .", ". k l 10m d k .", ". k 10m dd k .", ". 14k .",
    "6. kaek 6.", "6. kaek 6.", "6. kaek 6.", "6. kaek 6.", "6. kaek 6.", "6. kaek 6.", "6. kaek 6.", "6. kaek 6.", "6. 4k 6.", "16."] },
  redevelop: { c: { m: "#C9CCDA", l: "#FFFFFF", a: "#FFC93C", d: "#E0A21F" }, r: [
    "16.", "5. kk 2. kk 5.", "4. kmk 2. kmk 4.", "4. kmk 2. kmk 4.", "4. kmkkkkmk 4.", "4. k 6m k 4.", "5. k 4m k 5.",
    "6. klmk 6.", "6. klmk 6.", "6. klmk 6.", "6. klmk 6.", "6. klmk 6.", "5. kaaaak 5.", "5. kaddak 5.", "5. 6k 5.", "16."] },
  select: { c: { w: "#FFFFFF" }, r: [
    "4. k 11.", "4. kk 10.", "4. kwk 9.", "4. k 2w k 8.", "4. k 3w k 7.", "4. k 4w k 6.", "4. k 5w k 5.", "4. k 6w k 4.",
    "4. k 7w k 3.", "4. k 4w 5k 2.", "4. kwwkwwk 5.", "4. kwk . kwwk 4.", "4. kk 2. kwwk 4.", "4. k 4. kwwk 3.", "10. 3k 3.", "16."] },
  city: { c: { l: "#3DD68C", m: "#3D8BFF", a: "#FFC93C" }, r: [
    "16.", "16.", "11. 3k 2.", "11. kak 2.", "7. 3k . kak 2.", "7. kmk . kak 2.", "7. kmk . kak 2.", "3. 3k . kmk . kak 2.",
    "3. klk . kmk . kak 2.", "3. klk . kmk . kak 2.", "3. klk . kmk . kak 2.", "3. klk . kmk . kak 2.", "2. 13k .", "16.", "16.", "16."] },
  feed: { c: { w: "#FFFFFF", a: "#3D8BFF" }, r: [
    "16.", "16.", "2. 12k 2.", ". k 12w k .", ". k 12w k .", ". kwwaawaawaawwk .", ". kwwaawaawaawwk .", ". k 12w k .",
    ". k 12w k .", "2. kkwwkkkkkkkk 2.", "3. kwk 10.", "2. kk 12.", "16.", "16.", "16.", "16."] },
  ff: { c: { a: "#3DD68C" }, r: [
    "16.", "16.", "2. k 5. k 7.", "2. kk 4. kk 6.", "2. kak 3. kak 5.", "2. kaak 2. kaak 4.", "2. kaaak . kaaak 3.", "2. kaaaakkaaaak 2.",
    "2. kaaaakkaaaak 2.", "2. kaaak . kaaak 3.", "2. kaak 2. kaak 4.", "2. kak 3. kak 5.", "2. kk 4. kk 6.", "2. k 5. k 7.", "16.", "16."] },
  crystal: { c: { a: "#9D7BFF", l: "#C4B2FF", d: "#7B5BE0", w: "#FFFFFF", e: "#C98A55" }, r: [
    "16.", "6. 4k 6.", "4. kkllaakk 4.", "3. kllw 5a k 3.", "2. kllw 7a k 2.", "2. kl 9a k 2.", "2. kl 8a dk 2.", "2. k 8a ddk 2.",
    "3. k 6a ddk 3.", "4. kkaaddkk 4.", "6. 4k 6.", "4. kk 4e kk 4.", "3. k 8e k 3.", "3. 10k 3.", "16.", "16."] },
  report: { c: { e: "#C98A55", a: "#8A97B4", w: "#FFF8E7", m: "#5B5277" }, r: [
    "16.", "6. 4k 6.", "3. kkkkaakkkk 3.", "3. keekkkkeek 3.", "3. ke 6w ek 3.", "3. kew 4m wek 3.", "3. ke 6w ek 3.", "3. kew 3m wwek 3.",
    "3. ke 6w ek 3.", "3. kew 4m wek 3.", "3. ke 6w ek 3.", "3. kew 2m 3w ek 3.", "3. ke 6w ek 3.", "3. k 8e k 3.", "3. 10k 3.", "16."] },
  cap: { c: { m: "#3D3560", l: "#6B6390", e: "#5B5277", a: "#FFC93C" }, r: [
    "16.", "16.", "16.", "7. kk 7.", "5. kkllkk 5.", "3. kk 6m kk 3.", ". kk 10m kk .", "k 14m k",
    ". kk 10m kk .", "3. ke 6m ek . a .", "3. k 8e k . a .", "3. 10k . a .", "13. aa .", "16.", "16.", "16."] },
  save: { c: { m: "#3D8BFF", w: "#C9CCDA", l: "#FFF8E7", a: "#FF5C7A" }, r: [
    "16.", ". 12k 3.", ". kmmk 6w kmk 2.", ". kmmk 6w kmmk .", ". kmmk 4w kwkmmk .", ". kmmk 4w kwkmmk .", ". kmm 8k mmk .", ". k 12m k .",
    ". kmm 8k mmk .", ". kmk 8l kmk .", ". kmk 8l kmk .", ". kmkl 6a lkmk .", ". kmk 8l kmk .", ". kmk 8l kmk .", ". 14k .", "16."] },
  history: { c: { w: "#FFF8E7" }, r: [
    "16.", "5. 6k 5.", "3. kk 6w kk 3.", "2. k 10w k 2.", "2. k 4w k 5w k 2.", ". k 5w k 6w k .", ". k 5w k 6w k .", ". k 5w 3k 4w k .",
    ". k 12w k .", ". k 12w k .", "2. k 10w k 2.", "2. k 10w k 2.", "3. kk 6w kk 3.", "5. 6k 5.", "16.", "16."] },
  back: { c: { a: "#3D8BFF", l: "#8CBCFF" }, r: [
    "16.", "16.", "16.", "5. k 10.", "4. kak 9.", "3. kaak 9.", "2. kaa 10k .", ". kaaa 10l k",
    ". k 13a k", "2. kaa 10k .", "3. kaak 9.", "4. kak 9.", "5. k 10.", "16.", "16.", "16."] },
  coin: { c: { a: "#FFC93C", l: "#FFF3C4", d: "#E0A21F" }, r: [
    "16.", "16.", "5. 6k 5.", "3. kk 6a kk 3.", "2. kaall 5a dk 2.", "2. kal 7a dk 2.", ". kal 3a dd 4a dk .", ". kal 3a dd 4a dk .",
    ". kal 3a dd 4a dk .", ". k 5a dd 4a dk .", "2. k 8a ddk 2.", "2. k 8a ddk 2.", "3. kk 6d kk 3.", "5. 6k 5.", "16.", "16."] },
  people: { c: { a: "#FFD6A8", l: "#FFF0DC", m: "#3D8BFF", d: "#2266D6" }, r: [
    "16.", "16.", "6. 4k 6.", "5. kllaak 5.", "5. klaaak 5.", "5. kaaaak 5.", "6. 4k 6.", "4. kk 4m kk 4.",
    "3. k 8m k 3.", "3. k 7m dk 3.", "3. k 7m dk 3.", "3. k 7m dk 3.", "3. 10k 3.", "16.", "16.", "16."] },
  smile: { c: { a: "#FFC93C" }, r: [
    "16.", "16.", "5. 6k 5.", "3. kk 6a kk 3.", "2. k 10a k 2.", "2. k 10a k 2.", ". k 3a k 4a k 3a k .", ". k 3a k 4a k 3a k .",
    ". k 12a k .", ". k 2a k 6a k 2a k .", "2. k 2a 6k 2a k 2.", "2. k 10a k 2.", "3. kk 6a kk 3.", "5. 6k 5.", "16.", "16."] },
  bus: { c: { m: "#3D8BFF", l: "#C6ECFF", d: "#FFF8E7", a: "#FFC93C", e: "#5B5277" }, r: [
    "16.", "16.", "2. 12k 2.", ". k 12m k .", ". kmllkllkllkmmk .", ". kmllkllkllkmmk .", ". k 12m k .", ". k 12d k .",
    ". k 11m ak .", ". 14k .", "2. 4k 4. 4k 2.", "2. keek 4. keek 2.", "3. kk 6. kk 3.", "16.", "16.", "16."] },
  leaf: { c: { m: "#3DD68C", l: "#8EF0BF", d: "#22B06D", e: "#A8683F" }, r: [
    "16.", "11. 4k .", "9. kkllmk .", "7. kkllmmmk .", "6. kllmmmmmk .", "5. klmmmmmmdk .", "4. klmmmmmmddk .", "4. kmmmmmdmmdk .",
    "3. kmmmmdmmmdk 2.", "3. kmmmdmmmddk 2.", "3. kmmdmmmddk 3.", "3. kmdmmdddk 4.", "2. kkdkkkkkk 5.", ". kek 12.", "kek 13.", "16."] },
  close: { c: { w: "#FF5C7A" }, r: [
    "16.", "16.", "16.", "2. 3k 6. 3k 2.", "2. kwwk 4. kwwk 2.", "2. kwwwk 2. kwwwk 2.", "3. kwwwkkwwwk 3.", "4. k 6w k 4.",
    "5. k 4w k 5.", "5. k 4w k 5.", "4. k 6w k 4.", "3. kwwwkkwwwk 3.", "2. kwwwk 2. kwwwk 2.", "2. kwwk 4. kwwk 2.", "2. 3k 6. 3k 2.", "16."] },
  wave: { c: { a: "#46B4F2", l: "#9EE3FF" }, r: [
    "16.", "16.", "16.", "2. 3k 5. 3k 3.", ". k 3l k 3. k 3l k 2.", "k 5a 3k 5a k .", "16a", "16a",
    "2a 3k 5a 3k 3a", "a k 3l k 3a k 3l k 2a", "k 5a 3k 5a k a", "16a", "16a", "16a", "16k", "16."] },
  hill: { c: { a: "#D6B97A", d: "#B8965A", m: "#E6D3A0", w: "#FFFFFF" }, r: [
    "16.", "16.", "16.", "7. kk 7.", "6. kwwk 6.", "5. kwmmk 6.", "4. kmmmmk 6.", "4. kaaaadk 5.",
    "3. kaaaaddk 5.", "3. kaaaaaddk 4.", "2. kaaaaaaddk 4.", "2. k 7a ddk 3.", ". k 9a ddk 2.", ". 14k .", "16.", "16."] },
  news: { c: { w: "#FFF8E7", m: "#5B5277", a: "#FF5C7A" }, r: [
    "16.", "16.", "2. 12k 2.", "2. k 10w k 2.", "2. kw 4a 4w wk 2.", "2. kw 4a w 2m wwk 2.", "2. kw 4a 4w wk 2.", "2. kw 4a w 2m wwk 2.",
    "2. k 10w k 2.", "2. kw 7m wwk 2.", "2. k 10w k 2.", "2. kw 7m wwk 2.", "2. k 10w k 2.", "2. 12k 2.", "16.", "16."] },
  citizen: { c: { h: "#7A4A2E", s: "#FFD6A8", p: "#FF9AAE", c: "#3DD68C" }, r: [
    "4. 8k 4.", "3. k 8h k 3.", "2. k 10h k 2.", "2. khh 5s hhhk 2.", "2. kh 8s hk 2.", "2. k 2s k 4s k 2s k 2.", "2. k 2s k 4s k 2s k 2.", "2. kp 8s pk 2.",
    "2. k 4s kk 4s k 2.", "3. k 8s k 3.", "4. 8k 4.", "3. k 8c k 3.", "2. k 10c k 2.", "2. k 10c k 2.", "2. k 10c k 2.", "2. 12k 2."] },
  mentor: { c: { h: "#E3E8F2", s: "#FFD6A8", p: "#FF9AAE", w: "#C6ECFF", b: "#FFFFFF", c: "#9D7BFF" }, r: [
    "4. 8k 4.", "3. k 8h k 3.", "2. k 10h k 2.", "2. khh 5s hhhk 2.", "2. kh 8s hk 2.", "2. k 4k 2s 4k k 2.", "2. k kwwk ss kwwk k 2.", "2. kp 8s pk 2.",
    "2. k 4s kk 4s k 2.", "3. k 8b k 3.", "4. 8k 4.", "3. k 8c k 3.", "2. k 10c k 2.", "2. k 10c k 2.", "2. k 10c k 2.", "2. 12k 2."] },
  brain: { c: { b: "#3D8BFF", w: "#C6ECFF" }, r: [
    "16.", "4. k . k 2. k . k 4.", "4. k . k 2. k . k 4.", "2. 12k 2.", "2. k 10b k 2.", "2k k 10b k 2k", "2. k 2b 2w 2b 2w 2b k 2.", "2k k 2b 2w 2b 2w 2b k 2k",
    "2. k 10b k 2.", "2k k 2b w 4b w 2b k 2k", "2. k 3b 4w 3b k 2.", "2k k 10b k 2k", "2. 12k 2.", "4. k . k 2. k . k 4.", "4. k . k 2. k . k 4.", "16."] },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** 游程行展开为定长 16 字符；不足补空、超出截断 */
export function expandRow(row: string, width = 16): string {
  let out = "";
  for (const t of row.split(" ")) {
    if (!t) continue;
    const m = /^(\d+)(.)$/.exec(t);
    out += m ? m[2].repeat(Number(m[1])) : t;
  }
  return out.padEnd(width, ".").slice(0, width);
}

/** 原始行宽（未补齐），供单测校验每行恰好 16 格 */
export function rawRowWidth(row: string): number {
  let n = 0;
  for (const t of row.split(" ")) {
    if (!t) continue;
    const m = /^(\d+)(.)$/.exec(t);
    n += m ? Number(m[1]) : t.length;
  }
  return n;
}

export function iconRows(name: IconName): string[] {
  return (ICONS[name] as IconDef).r;
}

const iconCache = new Map<IconName, Sprite>();

export function iconSprite(name: IconName): Sprite {
  const hit = iconCache.get(name);
  if (hit) return hit;
  const def = ICONS[name] as IconDef;
  const colors: Record<string, string> = { k: PX.ink, ...def.c };
  const groups = new Map<string, string[]>();
  def.r.forEach((raw, y) => {
    const row = expandRow(raw);
    let x = 0;
    while (x < 16) {
      const ch = row[x];
      if (ch === "." || !colors[ch]) {
        x++;
        continue;
      }
      const s0 = x;
      while (x < 16 && row[x] === ch) x++;
      const c = colors[ch];
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(`M${s0} ${y}h${x - s0}v1h-${x - s0}z`);
    }
  });
  const sprite: Sprite = {
    w: 16,
    h: 16,
    layers: [...groups].map(([c, d]) => ({ c, d: d.join("") })),
  };
  iconCache.set(name, sprite);
  return sprite;
}

/* ------------------------------------------------------- 等距像素光栅器 */

type Pt = [number, number];
type Paint = string | null | ((x: number, y: number) => string | null);

interface Scene {
  W: number;
  H: number;
  ox: number;
  oy: number;
  col: (string | undefined)[];
  id: Int32Array;
  oc: (string | null)[];
  n: number;
}

interface BoxSpec {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  z0: number;
  z1: number;
  top: Paint;
  left: Paint;
  right: Paint;
  win?: string | null;
}

interface Span {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

type DrawItem =
  | { k: number; s: number; oc: string | null; box: BoxSpec }
  | { k: number; s: number; oc: string | null; tree: { r: number; c: number } }
  | { k: number; s: number; oc: string | null; car: { r: number; c: number } };

const TREE = ["..lll..", ".llmmm.", "llmmmmd", "lmmmmdd", "mmmmddd", ".mmddd.", "...t...", "...t..."];
const TREE_PAL = { l: "#A6E36A", m: "#6FD66B", d: "#3FAE5A", t: SCENE_COLORS.trunk };
const CAR = [".ll.", "mmmm", "k..k"];
const CAR_PAL = { l: "#FFF3C4", m: PX.sun, k: PX.ink };

function mkScene(W: number, H: number, ox: number, oy: number): Scene {
  return { W, H, ox, oy, col: new Array(W * H), id: new Int32Array(W * H), oc: [null, PX.ink], n: 2 };
}
const P = (S: Scene, r: number, c: number, z = 0): Pt => [S.ox + (c - r) * 8, S.oy + (c + r) * 4 - z];

function setPx(S: Scene, x: number, y: number, c: string | null, k: number) {
  if (c == null || x < 0 || y < 0 || x >= S.W || y >= S.H) return;
  const i = y * S.W + x;
  S.col[i] = c;
  S.id[i] = k;
}

function poly(S: Scene, pts: Pt[], c: Paint, k: number) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(S.H - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy))
        xs.push(a[0] + ((sy - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      const xa = Math.max(0, Math.ceil(xs[j] - 0.5));
      const xb = Math.min(S.W - 1, Math.floor(xs[j + 1] - 0.5));
      for (let x = xa; x <= xb; x++) setPx(S, x, y, typeof c === "function" ? c(x, y) : c, k);
    }
  }
}

function line(S: Scene, a: Pt, b: Pt, c: string, k: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const n = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= n; i++) setPx(S, Math.floor(a[0] + (dx * i) / n), Math.floor(a[1] + (dy * i) / n), c, k);
}

function stamp(S: Scene, x0: number, y0: number, rows: string[], map: Record<string, string>, k: number) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] !== ".") setPx(S, x0 + i, y0 + j, map[row[i]], k);
  });
}

function drawBox(S: Scene, b: BoxSpec, k: number) {
  const H = b.z1 - b.z0;
  const A = P(S, b.r0, b.c0, b.z1);
  const B = P(S, b.r0, b.c1, b.z1);
  const C = P(S, b.r1, b.c1, b.z1);
  const D = P(S, b.r1, b.c0, b.z1);
  const Bb = P(S, b.r0, b.c1, b.z0);
  const Cb = P(S, b.r1, b.c1, b.z0);
  const Db = P(S, b.r1, b.c0, b.z0);
  if (H > 0) {
    let fl: Paint = b.left;
    let fr: Paint = b.right;
    const win = b.win;
    if (win && H >= 7) {
      const isWin = (h: number, u: number, edge: number, mod: number) =>
        h >= 2 && h <= H - 3 && (h % 5 === 2 || h % 5 === 3) && u >= 1 && edge >= 2 && u % 3 !== mod;
      fl = (x, y) => (isWin(Math.floor(Db[1] - y + (x - Db[0]) * 0.5), x - Db[0], Cb[0] - x, 0) ? win : (b.left as string));
      fr = (x, y) => (isWin(Math.floor(Cb[1] - y - (x - Cb[0]) * 0.5), x - Cb[0], Bb[0] - x, 1) ? win : (b.right as string));
    }
    poly(S, [Db, Cb, C, D], fl, k);
    poly(S, [Cb, Bb, B, C], fr, k);
  }
  poly(S, [A, B, C, D], b.top, k);
}

function plinth(S: Scene, n: number, depth: number) {
  const Db = P(S, n, 0, -depth);
  const Cb = P(S, n, n, -depth);
  const Bb = P(S, 0, n, -depth);
  const band = (h: number, right: boolean) =>
    h >= depth - 2
      ? right ? "#6AB04F" : SCENE_COLORS.plinthGrass
      : right ? "#6A3F27" : SCENE_COLORS.plinthDeep;
  poly(S, [Db, Cb, P(S, n, n), P(S, n, 0)], (x, y) => band(Math.floor(Db[1] - y + (x - Db[0]) * 0.5), false), 1);
  poly(S, [Cb, Bb, P(S, 0, n), P(S, n, n)], (x, y) => band(Math.floor(Cb[1] - y - (x - Cb[0]) * 0.5), true), 1);
}

function finish(S: Scene): Sprite {
  const { W, H, id } = S;
  const out = S.col.slice();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = id[i];
      if (!k || !S.oc[k]) continue;
      const n1 = x > 0 ? id[i - 1] : 0;
      const n2 = x < W - 1 ? id[i + 1] : 0;
      const n3 = y > 0 ? id[i - W] : 0;
      const n4 = y < H - 1 ? id[i + W] : 0;
      if (n1 < k || n2 < k || n3 < k || n4 < k) out[i] = S.oc[k]!;
    }
  const groups = new Map<string, string[]>();
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = out[y * W + x];
      if (c == null) {
        x++;
        continue;
      }
      const s0 = x;
      while (x < W && out[y * W + x] === c) x++;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(`M${s0} ${y}h${x - s0}v1h-${x - s0}z`);
    }
  }
  return { w: W, h: H, layers: [...groups].map(([c, d]) => ({ c, d: d.join("") })) };
}

const inset = (sp: Span, d: number): Span => ({ r0: sp.r0 + d, c0: sp.c0 + d, r1: sp.r1 - d, c1: sp.c1 - d });
const capOf = (f: FaceColors): FaceColors => ({ m: f.t, d: f.m, t: f.w, w: f.w });
const solid = (m: string, d: string, t: string): FaceColors => ({ m, d, t, w: t });

const ROOF = solid(SCENE_COLORS.roof, SCENE_COLORS.roofDark, "#FF9E6B");
const WHITE = { m: PX.paper, d: PX["paper-4"], t: "#FFFFFF", w: SCENE_COLORS.glass };
const PLAZA = solid(PX["paper-4"], "#C9A66A", PX["paper-2"]);
const TRACK = solid("#C04F3A", "#A53F2D", SCENE_COLORS.track);
const TRACK_IN = solid("#4FC064", "#3FAE5A", SCENE_COLORS.trackInner);
const DECK = CATEGORY_FACES.utility;
const RAILING = solid("#E3E8F2", "#B7C1D6", "#FFFFFF");
const DECAL = solid("#FFFFFF", "#FFFFFF", "#FFFFFF");
const AWNING = solid(PX.berry, PX["berry-dark"], PX.paper);

/** 区块缩略图模型（造型与 tileModels.ts 对应，按 1 格缩略） */
function tileModel(type: TileType): DrawItem[] {
  const out: DrawItem[] = [];
  const sp: Span = { r0: 0, c0: 0, r1: 1, c1: 1 };
  const f = CATEGORY_FACES[TILE_SPECS[type].category];
  const key = 2;
  const box = (s: Span, z0: number, z1: number, col: FaceColors, win = false) =>
    out.push({ k: key, s: out.length, oc: PX.ink, box: { ...s, z0, z1, top: col.t, left: col.m, right: col.d, win: win ? col.w : null } });
  const tree = (r: number, c: number) => out.push({ k: key, s: out.length, oc: PX.ink, tree: { r, c } });
  let a: Span;
  switch (type) {
    case "res_low":
      box(inset(sp, 0.14), 0, 5, f);
      box(inset(sp, 0.08), 5, 7, ROOF);
      box(inset(sp, 0.26), 7, 9, ROOF);
      break;
    case "res_mid":
      box(inset(sp, 0.12), 0, 9, f, true);
      box(inset(sp, 0.3), 9, 11, capOf(f));
      break;
    case "res_high":
      box(inset(sp, 0.16), 0, 13, f, true);
      box(inset(sp, 0.3), 13, 15, capOf(f));
      break;
    case "com_shop":
      a = inset(sp, 0.12);
      box(a, 0, 6, f, true);
      box({ r0: a.r1 - 0.02, c0: a.c0, r1: a.r1 + 0.1, c1: a.c1 }, 2, 3, AWNING);
      break;
    case "com_cbd":
      box(inset(sp, 0.08), 0, 4, f);
      box(inset(sp, 0.26), 4, 14, f, true);
      box(inset(sp, 0.36), 14, 16, capOf(f));
      break;
    case "ind_light":
      a = inset(sp, 0.1);
      box(a, 0, 6, f);
      box({ r0: a.r0, c0: a.c0 + 0.04, r1: 0.5, c1: a.c1 - 0.04 }, 6, 8, capOf(f));
      box({ r0: 0.5, c0: a.c0 + 0.04, r1: a.r1, c1: a.c1 - 0.04 }, 6, 8, capOf(f));
      break;
    case "ind_heavy":
      box({ r0: 0.1, c0: 0.66, r1: 0.3, c1: 0.86 }, 0, 16, CATEGORY_FACES.utility);
      box({ r0: 0.1, c0: 0.66, r1: 0.3, c1: 0.86 }, 13, 14, CATEGORY_FACES.service);
      box({ r0: 0.36, c0: 0.1, r1: 0.9, c1: 0.9 }, 0, 7, f);
      break;
    case "green_park":
      box(inset(sp, 0.06), 0, 1, f);
      tree(0.5, 0.55);
      break;
    case "green_plaza":
      box(inset(sp, 0.06), 0, 1, PLAZA);
      box(inset(sp, 0.3), 1, 1, DECAL);
      box({ r0: 0.4, c0: 0.4, r1: 0.6, c1: 0.6 }, 1, 11, WHITE);
      break;
    case "edu_school":
      a = { r0: 0.08, c0: 0.08, r1: 0.46, c1: 0.92 };
      box(a, 0, 7, f, true);
      box(inset(a, 0.04), 7, 9, solid(PX["berry-dark"], "#B02F4A", "#FF9AAE"));
      a = { r0: 0.54, c0: 0.08, r1: 0.92, c1: 0.92 };
      box(a, 0, 1, TRACK);
      box(inset(a, 0.1), 1, 1, TRACK_IN);
      break;
    case "med_clinic":
      a = inset(sp, 0.1);
      box(a, 0, 8, WHITE, true);
      box(a, 8, 10, f);
      box({ r0: 0.44, c0: 0.28, r1: 0.56, c1: 0.72 }, 10, 10, DECAL);
      box({ r0: 0.28, c0: 0.44, r1: 0.72, c1: 0.56 }, 10, 10, DECAL);
      break;
    case "trans_metro":
      box(inset(sp, 0.18), 0, 5, f);
      box(inset(sp, 0.13), 5, 6, { m: f.t, d: f.m, t: f.w, w: f.w });
      box({ r0: 0.83, c0: 0.07, r1: 0.94, c1: 0.18 }, 0, 9, CATEGORY_FACES.utility);
      box({ r0: 0.79, c0: 0.03, r1: 0.98, c1: 0.22 }, 9, 12, f);
      break;
    case "trans_avenue":
    case "trans_highway":
    case "trans_road":
      out.push({ k: key, s: out.length, oc: null, car: { r: 0.6, c: 0.45 } });
      break;
    case "util_bridge":
      box({ r0: 0, c0: 0.24, r1: 1, c1: 0.76 }, 1, 3, DECK);
      box({ r0: 0, c0: 0.24, r1: 1, c1: 0.32 }, 3, 4, RAILING);
      box({ r0: 0, c0: 0.68, r1: 1, c1: 0.76 }, 3, 4, RAILING);
      break;
  }
  return out;
}

const tileCache = new Map<TileType, Sprite>();

/** 区块等距像素缩略图：24×28 逻辑像素 */
export function tileSprite(type: TileType): Sprite {
  const hit = tileCache.get(type);
  if (hit) return hit;
  const S = mkScene(24, 28, 12, 17);
  plinth(S, 1, 3);
  const ground =
    type === "trans_road" || type === "trans_avenue" || type === "trans_highway" ? SCENE_COLORS.asphalt : type === "util_bridge" ? SCENE_COLORS.water : "#9BDE6E";
  poly(S, [P(S, 0, 0), P(S, 0, 1), P(S, 1, 1), P(S, 1, 0)], ground, 1);
  if (type === "trans_road") line(S, P(S, 0.25, 0.5), P(S, 0.55, 0.5), PX.paper, 1);
  if (type === "util_bridge") {
    const p = P(S, 0.4, 0.3);
    setPx(S, Math.floor(p[0]), Math.floor(p[1]), "#C8F1FF", 1);
    setPx(S, Math.floor(p[0]) + 1, Math.floor(p[1]), "#C8F1FF", 1);
  }
  const items = tileModel(type).sort((a, b) => a.k - b.k || a.s - b.s);
  for (const it of items) {
    const k = S.n++;
    S.oc[k] = it.oc;
    if ("box" in it) drawBox(S, it.box, k);
    else if ("tree" in it) {
      const p = P(S, it.tree.r, it.tree.c);
      stamp(S, Math.round(p[0]) - 3, Math.round(p[1]) - 7, TREE, TREE_PAL, k);
    } else {
      const p = P(S, it.car.r, it.car.c);
      stamp(S, Math.round(p[0]) - 2, Math.round(p[1]) - 2, CAR, CAR_PAL, k);
    }
  }
  const sprite = finish(S);
  tileCache.set(type, sprite);
  return sprite;
}
