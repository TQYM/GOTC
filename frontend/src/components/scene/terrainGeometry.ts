/**
 * 地形层几何（11 §6.2）：整张 48×48 地面合成一个 BufferGeometry，按地形值顶点着色。
 * - 每格一个顶面四边形（高度见 TERRAIN_HEIGHT）；
 * - 相邻格高差处补竖直侧壁；棋盘外缘侧壁一直落到底座底面，形成「沙盘模型」底座；
 * - 水面另出一块半透明几何（河道格）；网格线另出 LineSegments。
 */
import * as THREE from "three";
import type { Parcel, Terrain } from "@/lib/contract";
import { SCENE_COLORS, TERRAIN_COLORS } from "@/lib/palette";
import { PLINTH_BOTTOM, TERRAIN_HEIGHT, gridOf } from "./coords";

const WATER_LEVEL = -1.2;

function colorOf(t: Terrain): THREE.Color {
  return new THREE.Color(
    t === "river" ? SCENE_COLORS.riverbed : TERRAIN_COLORS[t],
  );
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
  const plinth = new THREE.Color(SCENE_COLORS.plinth);
  const palette = new Map<Terrain, THREE.Color>();
  const paint = (t: Terrain) => {
    let c = palette.get(t);
    if (!c) palette.set(t, (c = colorOf(t)));
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
      const top = paint(t);
      // 顶面（法线朝 +y：顺序 NW→SW→SE→NE）
      quad([x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0], top);

      // 侧壁：只有本格更高时才画，朝向低的一侧
      const wallColor = (nh: number) =>
        nh === PLINTH_BOTTOM ? plinth : top.clone().multiplyScalar(0.82);
      const north = heightAt(r - 1, c);
      if (north < h)
        quad(
          [x1, h, z0],
          [x1, north, z0],
          [x0, north, z0],
          [x0, h, z0],
          wallColor(north),
        );
      const south = heightAt(r + 1, c);
      if (south < h)
        quad(
          [x0, h, z1],
          [x0, south, z1],
          [x1, south, z1],
          [x1, h, z1],
          wallColor(south),
        );
      const west = heightAt(r, c - 1);
      if (west < h)
        quad(
          [x0, h, z0],
          [x0, west, z0],
          [x0, west, z1],
          [x0, h, z1],
          wallColor(west),
        );
      const east = heightAt(r, c + 1);
      if (east < h)
        quad(
          [x1, h, z1],
          [x1, east, z1],
          [x1, east, z0],
          [x1, h, z0],
          wallColor(east),
        );

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
