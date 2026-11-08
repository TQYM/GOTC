/**
 * 14 种区块的程序化像素体块模型（11 §6.2 / 16 §5.1：去圆角、统一色板、顶面提亮）。
 *
 * 每种区块的多个部件（楼体、屋顶、烟囱、十字……）合并为一个带顶点色的 BufferGeometry，
 * 以便同类区块用一个 InstancedMesh 合批（≤14 draw call）。
 * 模型原点 = 占地外接矩形中心、地面高度；单位米。桥按「1 格长」建模，实例沿长轴缩放。
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TileType } from "@/lib/contract";
import { TILE_SPECS } from "@/lib/catalog";
import { CATEGORY_COLORS, CATEGORY_FACES, PX, SCENE_COLORS } from "@/lib/palette";

class Parts {
  private list: THREE.BufferGeometry[] = [];

  add(
    geom: THREE.BufferGeometry,
    color: string,
    x = 0,
    y = 0,
    z = 0,
    rotY = 0,
  ) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    if (geom !== g) geom.dispose();
    g.deleteAttribute("uv");
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    // 像素画「顶亮」：朝上的面提亮，与 UI 缩略图的顶面色一致
    const top = c.clone().lerp(new THREE.Color("#ffffff"), 0.22);
    const n = g.getAttribute("position").count;
    const normal = g.getAttribute("normal");
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = normal && normal.getY(i) > 0.5 ? top : c;
      arr[i * 3] = k.r;
      arr[i * 3 + 1] = k.g;
      arr[i * 3 + 2] = k.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    this.list.push(g);
    return this;
  }

  /** 直角体块（体素感，16 §5.1 去圆角），底面落在 y */
  box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z);
  }

  /** 直角薄板（地坪、标线），底面落在 y */
  slab(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z);
  }

  cylinder(r: number, h: number, color: string, x = 0, y = 0, z = 0, seg = 10) {
    return this.add(
      new THREE.CylinderGeometry(r, r, h, seg),
      color,
      x,
      y + h / 2,
      z,
    );
  }

  /** 四坡屋顶：底面落在 y */
  hipRoof(w: number, h: number, color: string, x = 0, y = 0, z = 0) {
    const g = new THREE.ConeGeometry((w / 2) * Math.SQRT2, h, 4);
    return this.add(g, color, x, y + h / 2, z, Math.PI / 4);
  }

  /** 横向楼层带（13 §1.2：立面用色块与线脚表达，高层 2–3 条） */
  bands(
    w: number,
    d: number,
    from: number,
    to: number,
    step: number,
    color: string,
    x = 0,
    z = 0,
  ) {
    for (let y = from; y < to - 1; y += step)
      this.slab(w * 1.04, 0.8, d * 1.04, color, x, y, z);
    return this;
  }

  /** 双坡屋顶（三角棱柱，屋脊沿 x），底面落在 y */
  gable(
    len: number,
    span: number,
    h: number,
    color: string,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const shape = new THREE.Shape();
    shape.moveTo(-span / 2, 0);
    shape.lineTo(span / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: len,
      bevelEnabled: false,
    });
    g.translate(0, 0, -len / 2);
    g.rotateY(Math.PI / 2);
    return this.add(g, color, x, y, z);
  }

  /** 椭圆地坪（操场跑道等），底面落在 y */
  oval(rx: number, rz: number, h: number, color: string, x = 0, y = 0, z = 0) {
    const g = new THREE.CylinderGeometry(rz, rz, h, 28);
    g.scale(rx / rz, 1, 1);
    return this.add(g, color, x, y + h / 2, z);
  }

  /** 球冠树：树干 + 球状树冠 */
  tree(x: number, z: number, scale = 1, y = 0) {
    this.cylinder(1.2 * scale, 5 * scale, SCENE_COLORS.trunk, x, y, z, 6);
    return this.add(
      new THREE.IcosahedronGeometry(5.5 * scale, 1),
      SCENE_COLORS.treeCrown,
      x,
      y + 9 * scale,
      z,
    );
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.list, false);
    for (const g of this.list) g.dispose();
    if (!merged) throw new Error("合并区块模型失败");
    merged.computeBoundingSphere();
    return merged;
  }
}

const tint = (hex: string, k: number) =>
  "#" + new THREE.Color(hex).multiplyScalar(k).getHexString();
const lighten = (hex: string, t: number) =>
  "#" + new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), t).getHexString();

function make(type: TileType, s: number): THREE.BufferGeometry {
  const [fh, fw] = TILE_SPECS[type].footprint;
  const W = fw * s;
  const D = fh * s;
  const inset = s * 0.12;
  const w = W - inset * 2;
  const d = D - inset * 2;
  const base = CATEGORY_COLORS[TILE_SPECS[type].category];
  const p = new Parts();

  switch (type) {
    case "res_low":
      p.box(w * 0.8, 9, d * 0.8, base)
        .box(w * 0.9, 3, d * 0.9, SCENE_COLORS.roof, 0, 9)
        .box(w * 0.6, 3, d * 0.6, SCENE_COLORS.roof, 0, 12);
      break;
    case "res_mid":
      p.box(w * 0.9, 22, d * 0.9, base)
        .bands(w * 0.9, d * 0.9, 7.5, 22, 7.5, lighten(base, 0.45))
        .slab(w * 0.94, 1.5, d * 0.94, lighten(base, 0.5), 0, 22)
        .box(8, 4, 8, lighten(base, 0.6), -w * 0.2, 23.5, -d * 0.2);
      break;
    case "res_high":
      p.box(w * 0.68, 58, d * 0.68, base)
        .bands(w * 0.68, d * 0.68, 15, 58, 14.5, lighten(base, 0.45))
        .box(w * 0.74, 3, d * 0.74, lighten(base, 0.55), 0, 58)
        .box(w * 0.3, 5, d * 0.3, lighten(base, 0.7), 0, 61);
      break;
    case "com_shop":
      p.box(w * 0.92, 9, d * 0.92, base)
        .slab(w * 0.96, 1.2, 6, SCENE_COLORS.accentLight, 0, 6, d * 0.46 + 2)
        .slab(w * 0.5, 2.5, 1, lighten(base, 0.6), 0, 9.5, d * 0.3);
      break;
    case "com_cbd":
      p.box(w, 12, d, base)
        .box(w * 0.55, 82, d * 0.55, lighten(base, 0.25), 0, 12)
        .bands(w * 0.55, d * 0.55, 34, 94, 20, lighten(base, 0.6))
        .box(w * 0.36, 7, d * 0.36, lighten(base, 0.6), 0, 94);
      break;
    case "ind_light":
      p.box(w, 12, d * 0.62, base, 0, 0, -d * 0.16)
        .box(w * 0.5, 8, d * 0.3, tint(base, 0.85), -w * 0.22, 0, d * 0.33)
        .box(w * 0.2, 3, d * 0.2, lighten(base, 0.5), w * 0.25, 12, -d * 0.16);
      break;
    case "ind_heavy":
      p.box(w * 0.92, 18, d * 0.58, base, 0, 0, -d * 0.18)
        .cylinder(12, 26, CATEGORY_FACES.industrial.w, -w * 0.28, 0, d * 0.3, 14)
        .cylinder(12, 26, CATEGORY_FACES.industrial.w, 0, 0, d * 0.3, 14)
        .box(8, 55, 8, CATEGORY_FACES.utility.m, w * 0.3, 0, d * 0.28)
        .box(8.6, 4, 8.6, PX.berry, w * 0.3, 47, d * 0.28)
        .box(8, 48, 8, CATEGORY_FACES.utility.m, w * 0.3, 0, -d * 0.38)
        .box(8.6, 4, 8.6, PX.berry, w * 0.3, 40, -d * 0.38);
      break;
    case "green_park":
      p.slab(W - 4, 0.8, D - 4, base)
        .slab(W - 4, 0.9, 4, PX["paper-2"])
        .tree(-12, -12, 1.1, 0.8)
        .tree(13, -8, 0.9, 0.8)
        .tree(-8, 13, 1, 0.8);
      break;
    case "green_plaza":
      p.slab(W - 6, 1, D - 6, lighten(base, 0.45))
        .slab(W * 0.42, 1.3, D * 0.42, PX["paper-2"])
        .box(6, 24, 6, SCENE_COLORS.accentLight, 0, 1.3, 0)
        .tree(-W * 0.32, -D * 0.32, 1.3, 1)
        .tree(W * 0.32, -D * 0.32, 1.3, 1)
        .tree(-W * 0.32, D * 0.32, 1.3, 1)
        .tree(W * 0.32, D * 0.32, 1.3, 1);
      break;
    case "edu_school":
      // 识别套件（13 §1.3）：L 形坡顶教学楼 + 红色塑胶跑道操场
      p.box(w, 13, d * 0.3, base, 0, 0, -d * 0.35)
        .gable(w, d * 0.3 + 2, 6, PX["berry-dark"], 0, 13, -d * 0.35)
        .box(w * 0.28, 13, d * 0.42, base, -w * 0.36, 0, d * 0.13)
        .oval(w * 0.3, d * 0.22, 0.8, SCENE_COLORS.track, w * 0.16, 0, d * 0.2)
        .oval(w * 0.22, d * 0.14, 1, SCENE_COLORS.trackInner, w * 0.16, 0, d * 0.2)
        .cylinder(0.6, 18, SCENE_COLORS.accentDark, w * 0.44, 0, -d * 0.08, 6)
        .slab(5, 3, 0.4, PX.bad, w * 0.44 + 2.6, 15, -d * 0.08);
      break;
    case "med_clinic":
      p.box(w * 0.86, 22, d * 0.72, base, 0, 0, -d * 0.08)
        .box(w * 0.4, 7, d * 0.2, lighten(base, 0.6), 0, 0, d * 0.36)
        .slab(26, 1.4, 8, SCENE_COLORS.accentLight, 0, 22, -d * 0.08)
        .slab(8, 1.4, 26, SCENE_COLORS.accentLight, 0, 22, -d * 0.08);
      break;
    case "trans_metro":
      p.box(24, 6, 18, base)
        .slab(30, 1.5, 24, SCENE_COLORS.accentLight, 0, 6)
        .cylinder(0.8, 12, SCENE_COLORS.accentDark, 13, 0, 13, 6)
        .add(
          new THREE.CylinderGeometry(4, 4, 1.2, 16).rotateX(Math.PI / 2),
          base,
          13,
          14,
          13,
        );
      break;
    case "trans_road":
      p.slab(s, 0.6, s, SCENE_COLORS.asphalt)
        .slab(1.6, 0.7, s * 0.28, SCENE_COLORS.accentLight, 0, 0, -s * 0.3)
        .slab(1.6, 0.7, s * 0.28, SCENE_COLORS.accentLight, 0, 0, s * 0.3);
      break;
    case "util_bridge":
      // 沿 x 方向 1 格长；实例按跨度缩放 x，竖向桥绕 y 旋转 90°
      p.slab(s, 2, 30, base, 0, 2)
        .slab(s, 2.5, 1.5, tint(base, 0.7), 0, 4, 14.2)
        .slab(s, 2.5, 1.5, tint(base, 0.7), 0, 4, -14.2)
        .cylinder(3, 8, tint(base, 0.8), 0, -6, 0, 8);
      break;
  }
  return p.build();
}

const cache = new Map<string, THREE.BufferGeometry>();

export function tileGeometry(
  type: TileType,
  cellSize: number,
): THREE.BufferGeometry {
  const key = `${type}@${cellSize}`;
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make(type, cellSize)));
  return g;
}

/** 林地树木（单棵），林地层用一个 InstancedMesh 合批 */
export function treeGeometry(): THREE.BufferGeometry {
  const key = "tree";
  let g = cache.get(key);
  if (!g) cache.set(key, (g = new Parts().tree(0, 0, 1.4).build()));
  return g;
}

/** 方形格框（覆盖格预览 / 悬停高亮），边长 = 格宽 × 0.92 */
export function cellFrameGeometry(cellSize: number): THREE.BufferGeometry {
  const key = `frame@${cellSize}`;
  let g = cache.get(key);
  if (!g) {
    const L = cellSize * 0.92;
    const t = Math.max(1.2, cellSize * 0.05);
    const p = new Parts()
      .slab(L, 0.6, t, "#ffffff", 0, 0, -(L - t) / 2)
      .slab(L, 0.6, t, "#ffffff", 0, 0, (L - t) / 2)
      .slab(t, 0.6, L - 2 * t, "#ffffff", -(L - t) / 2, 0, 0)
      .slab(t, 0.6, L - 2 * t, "#ffffff", (L - t) / 2, 0, 0);
    cache.set(key, (g = p.build()));
  }
  return g;
}
