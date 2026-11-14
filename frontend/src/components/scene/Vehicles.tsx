"use client";

/**
 * 路面上的车。
 *
 * 与 `CitizenDots` 同一套路网：都用 `findRoadPath` 在道路格上做 4 邻域 BFS，
 * 差别是车只跑「路到路」的短程，速度是步行的 6–9 倍，还带车道偏移——
 * 双向各占半边，错车时不会叠在同一条线上。
 *
 * 车不需要「家到公司」的语义：它只是路面上的流量。所以起终点从道路格里
 * 随机抽，路径长度落在 6–24 格之间，跑完就换一条。
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Parcel, Tile } from "@/lib/contract";
import { gridOf } from "./coords";
import { cumulative, findRoadPath, isRoad } from "./CitizenDots";

/** 车顶点数上限：64 辆已经够让街面「活」起来，再多会挤 */
const MAX_CARS = 64;
/** 每秒走完单程的比例，比步行快一个量级 */
const DRIVE_SPEED = 0.35;
/** 车道偏移：道路格宽的 0.16 倍，够看出双向 */
const LANE_OFFSET = 0.16;

const CAR_COLORS = [
  "#F2F2F2", // 白
  "#2A2340", // 墨黑
  "#FF5C7A", // 红
  "#FFC93C", // 黄
  "#3D8BFF", // 蓝
  "#8A97B4", // 灰
];

interface Car {
  path: number[];
  cum: number[];
  phase: number;
  speed: number;
  /** +1 右侧车道，-1 左侧 */
  lane: number;
  /** 车身色索引 */
  color: number;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}

export function Vehicles({ parcel, tiles }: { parcel: Parcel; tiles: Tile[] }) {
  const grid = useMemo(() => gridOf(parcel), [parcel]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorArray = useMemo(() => new Float32Array(MAX_CARS * 3), []);

  const gridForPath = useMemo(
    () => ({
      size: grid.size,
      cell: grid.cell,
      originX: -(grid.size * grid.cell) / 2,
      originZ: -(grid.size * grid.cell) / 2,
    }),
    [grid],
  );

  const cars = useMemo<Car[]>(() => {
    // 先把道路格收集起来：没有路就没有车
    const roads: [number, number][] = [];
    for (let r = 0; r < grid.size; r += 1) {
      for (let c = 0; c < grid.size; c += 1) {
        if (isRoad(parcel, tiles, r, c)) roads.push([r, c]);
      }
    }
    if (roads.length < 8) return [];

    const count = Math.min(MAX_CARS, Math.max(6, Math.floor(roads.length / 12)));
    const out: Car[] = [];
    for (let i = 0; i < count; i += 1) {
      const seed = hash(`car:${i}`);
      const from = roads[seed % roads.length];
      const to = roads[(seed * 31 + 17) % roads.length];
      if (!from || !to) continue;
      const path = findRoadPath(parcel, tiles, gridForPath, from, to);
      // 找不到连通路径就跳过（可能两端在不同路网片段）
      if (!path || path.length < 6) continue;
      const cum = cumulative(path);
      out.push({
        path,
        cum,
        phase: ((seed >>> 5) & 1023) / 1023,
        speed: DRIVE_SPEED * (0.75 + ((seed >>> 13) & 7) / 7 * 0.5),
        lane: (seed & 1) === 0 ? 1 : -1,
        color: (seed >>> 9) % CAR_COLORS.length,
      });
    }
    return out;
  }, [parcel, tiles, grid, gridForPath]);

  // 车身色写进 instanceColor：一辆车一次上色，比给每辆车单独材质省得多
  useMemo(() => {
    for (let i = 0; i < cars.length; i += 1) {
      const c = new THREE.Color(CAR_COLORS[cars[i]!.color]);
      colorArray[i * 3] = c.r;
      colorArray[i * 3 + 1] = c.g;
      colorArray[i * 3 + 2] = c.b;
    }
  }, [cars, colorArray]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || cars.length === 0) return;
    const time = state.clock.elapsedTime;
    // 车身中心抬到路面之上一点，别陷进地里
    const y = grid.cell * 0.11;

    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i]!;
      const total = car.cum[car.cum.length - 1] ?? 1;
      if (total <= 0) continue;

      // 0..2 往返：0→1 去程，1→2 回程（回程换到对向车道）
      const cycle = (time * car.speed + car.phase) % 2;
      const forward = cycle <= 1;
      const t = forward ? cycle : 2 - cycle;

      const pos = positionAt(car.path, car.cum, t);
      const ahead = positionAt(car.path, car.cum, Math.min(1, t + 0.02));

      // 切线方向 → 车道法线；回程时切线取反，法线自然换边
      let dirX = ahead.x - pos.x;
      let dirZ = ahead.z - pos.z;
      if (!forward) {
        dirX = -dirX;
        dirZ = -dirZ;
      }
      const len = Math.hypot(dirX, dirZ) || 1;
      const nx = -dirZ / len;
      const nz = dirX / len;
      const offset = grid.cell * LANE_OFFSET * car.lane;

      dummy.position.set(pos.x + nx * offset, y, pos.z + nz * offset);
      // 车身沿行进方向摆放
      dummy.rotation.set(0, Math.atan2(dirX, dirZ), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.count = cars.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (cars.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, cars.length]}
      frustumCulled={false}
    >
      {/* 车身：扁一点的长方体，长轴朝 +Z（与 rotation.y 的朝向约定对齐） */}
      <boxGeometry args={[grid.cell * 0.14, grid.cell * 0.1, grid.cell * 0.32]} />
      <meshBasicMaterial vertexColors />
      <instancedBufferAttribute
        attach="instanceColor"
        args={[colorArray, 3]}
      />
    </instancedMesh>
  );
}

/** 按归一化进度取路径上的点（与 CitizenDots 的 pathPosition 同算法，内联一份省 import 循环） */
function positionAt(path: number[], cum: number[], t: number): { x: number; z: number } {
  const total = cum[cum.length - 1] ?? 0;
  if (total <= 0 || path.length < 4) return { x: 0, z: 0 };
  const target = Math.max(0, Math.min(1, t)) * total;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] ?? 0) <= target) lo = mid;
    else hi = mid;
  }
  const segLen = (cum[hi] ?? 0) - (cum[lo] ?? 0);
  const k = segLen > 0 ? (target - (cum[lo] ?? 0)) / segLen : 0;
  const x0 = path[lo * 2] ?? 0;
  const z0 = path[lo * 2 + 1] ?? 0;
  const x1 = path[hi * 2] ?? 0;
  const z1 = path[hi * 2 + 1] ?? 0;
  return { x: x0 + (x1 - x0) * k, z: z0 + (z1 - z0) * k };
}
