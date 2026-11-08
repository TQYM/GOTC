/**
 * 地形层几何（11 §6.2）：整张 48×48 地面合成一个 BufferGeometry，按地形值顶点着色。
 * - 每格一个顶面四边形（高度见 TERRAIN_HEIGHT）；
 * - 顶面按棋盘格交错两色（16 §3.3），出像素地砖感；
 * - 相邻格高差处补竖直侧壁；棋盘外缘侧壁一直落到底座底面，分草皮 / 泥土 / 深层泥土三层，形成「像素浮岛」底座；
 * - 水面另出一块半透明几何（河道格）；网格线另出 LineSegments。
 */
import * as THREE from "three";
import type { Parcel, Terrain } from "@/lib/contract";
import { SCENE_COLORS, TERRAIN_ALT_COLORS, TERRAIN_COLORS } from "@/lib/palette";
import { PLINTH_BOTTOM, TERRAIN_HEIGHT, gridOf } from "./coords";

const WATER_LEVEL = -1.2;

/** 底座分层：顶边草皮 → 泥土 → 深层泥土 */
const PLINTH_BANDS: [number, string][] = [
  [-2, SCENE_COLORS.plinthGrass],
  [-8, SCENE_COLORS.plinth],
  [PLINTH_BOTTOM, SCENE_COLORS.plinthDeep],
];

function colorOf(t: Terrain, alt: boolean): THREE.Color {
  if (t === "river") return new THREE.Color(SCENE_COLORS.riverbed);
  return new THREE.Color(alt ? TERRAIN_ALT_COLORS[t] : TERRAIN_COLORS[t]);
}

export interface TerrainGeometries {
  ground: THREE.BufferGeometry;
  water: THREE.BufferGeometry | null;
  grid: THREE.BufferGeometry;
}

export function buildTerrain(parcel: Parcel): TerrainGeometries {
  const { size: N, cell: s } = gridOf(parcel);
  const half = (N * s) / 2;
  const pos: number[] = [];
  const col: number[] = [];
  const waterPos: number[] = [];
  const gridPos: number[] = [];
  const bands = PLINTH_BANDS.map(([y, hex]) => [y, new THREE.Color(hex)] as const);
  const palette = new Map<string, THREE.Color>();
  const paint = (t: Terrain, alt: boolean) => {
    const key = `${t}:${alt ? 1 : 0}`;
    let c = palette.get(key);
    if (!c) palette.set(key, (c = colorOf(t, alt)));
    return c;
  };

  const heightAt = (r: number, c: number) =>
    r < 0 || c < 0 || r >= N || c >= N
      ? PLINTH_BOTTOM
      : TERRAIN_HEIGHT[parcel.terrain[r][c]];

  // 逆时针（从上往下看）的四边形 → 两个三角形
  const quad = (
    a: number[],
    b: number[],
    c: number[],
    d: number[],
    color: THREE.Color,
  ) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
  };

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const t = parcel.terrain[r][c];
      const h = TERRAIN_HEIGHT[t];
      const x0 = c * s - half;
      const x1 = x0 + s;
      const z0 = r * s - half;
      const z1 = z0 + s;
      const top = paint(t, ((r + c) & 1) === 1);
      // 顶面（法线朝 +y：顺序 NW→SW→SE→NE）
      quad([x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0], top);

      // 侧壁：只有本格更高时才画，朝向低的一侧；外缘落到底座底面时按三层分带
      const side = top.clone().multiplyScalar(0.82);
      const wall = (ax: number, az: number, bx: number, bz: number, nh: number) => {
        if (nh !== PLINTH_BOTTOM) {
          quad([ax, h, az], [ax, nh, az], [bx, nh, bz], [bx, h, bz], side);
          return;
        }
        let y = h;
        for (const [bottom, color] of bands) {
          if (bottom >= y) continue;
          quad([ax, y, az], [ax, bottom, az], [bx, bottom, bz], [bx, y, bz], color);
          y = bottom;
        }
      };
      const north = heightAt(r - 1, c);
      if (north < h) wall(x1, z0, x0, z0, north);
      const south = heightAt(r + 1, c);
      if (south < h) wall(x0, z1, x1, z1, south);
      const west = heightAt(r, c - 1);
      if (west < h) wall(x0, z0, x0, z1, west);
      const east = heightAt(r, c + 1);
      if (east < h) wall(x1, z1, x1, z0, east);

      if (t === "river") {
        waterPos.push(
          x0,
          WATER_LEVEL,
          z0,
          x0,
          WATER_LEVEL,
          z1,
          x1,
          WATER_LEVEL,
          z1,
        );
        waterPos.push(
          x0,
          WATER_LEVEL,
          z0,
          x1,
          WATER_LEVEL,
          z1,
          x1,
          WATER_LEVEL,
          z0,
        );
      } else {
        // 网格线：每格画北边与西边，末行/末列补南边/东边
        const y = h + 0.15;
        gridPos.push(x0, y, z0, x1, y, z0, x0, y, z0, x0, y, z1);
        if (r === N - 1) gridPos.push(x0, y, z1, x1, y, z1);
        if (c === N - 1) gridPos.push(x1, y, z0, x1, y, z1);
      }
    }
  }

  const ground = new THREE.BufferGeometry();
  ground.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  ground.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  ground.computeVertexNormals();
  ground.computeBoundingSphere();

  let water: THREE.BufferGeometry | null = null;
  if (waterPos.length) {
    water = new THREE.BufferGeometry();
    water.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(waterPos, 3),
    );
    water.computeVertexNormals();
  }

  const grid = new THREE.BufferGeometry();
  grid.setAttribute("position", new THREE.Float32BufferAttribute(gridPos, 3));
  return { ground, water, grid };
}
