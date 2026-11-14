"use client";

/**
 * 市民个体渲染（C:S 的 CitizenInstance 可视化等价物）。
 *
 * 早期版本是「按住宅密度撒一圈静态小点」—— 位置由哈希定死，永远不动。
 * 问题很明显：城在长、需求在动、车在跑，人却像钉子一样钉在地上。
 *
 * 现在每个点是一个真正的「通勤代理」：
 *   home（自己住的住宅）→ corner（L 形折点）→ dest（最近的一块岗位或另一块住宅）
 * 用 `clock.elapsedTime` 驱动 t 在 0..1 之间往返，位置沿折线插值，
 * 所以无论有没有真实路网文件（`networkUrl`）都能看到人在走。
 *
 * 性能上用 InstancedMesh 一次画完，不建 N 个 mesh；上限 160 个代理，
 * 数量随人口增长但封顶，避免 1 万人画出 1 万个实例。
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Parcel, Tile } from "@/lib/contract";
import { cellToWorld, gridOf } from "./coords";

const MAX_AGENTS = 160;
const MIN_AGENTS = 2;
const WALK_SPEED = 0.055; // 每秒走完往返的比例

const JOB_PREFIXES = ["com_", "ind_"];

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}

export interface Agent {
  hx: number;
  hz: number;
  dx: number;
  dz: number;
  /** L 形折线的拐点（walkOnRoads 找不到路时的兜底） */
  cx: number;
  cz: number;
  phase: number;
  speed: number;
  /** 沿道路的折线（世界坐标交错存 [x0,z0,x1,z1,…]）；为空则退回 L 形 */
  path?: number[];
  /** 与 path 等长的累积弧长，末项是总长 */
  cum?: number[];
}

/**
 * 给定进度 t∈[0,1]，沿 path 折线取点；path 为空时退回 L 形。
 *
 * 与直线插值的区别：每个拐角都是真实路口，人不会穿楼而过。
 */
export function pathPosition(path: number[], cum: number[], t: number): { x: number; z: number } {
  const n = cum.length;
  if (n < 2) return { x: path[0] ?? 0, z: path[1] ?? 0 };
  const total = cum[n - 1] || 1;
  const target = Math.min(1, Math.max(0, t)) * total;
  // 二分找段：160 个代理 × 60 点，线性也够，但二分更稳
  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const k = (target - cum[lo]) / seg;
  return {
    x: path[lo * 2] + (path[hi * 2] - path[lo * 2]) * k,
    z: path[lo * 2 + 1] + (path[hi * 2 + 1] - path[lo * 2 + 1]) * k,
  };
}

/** 道路格：玩家铺的 trans_* 或真实片区的 road_inherited。 */
export function isRoad(parcel: Parcel, tiles: Tile[], r: number, c: number): boolean {
  const t = parcel.terrain[r]?.[c];
  if (t === "road_inherited") return true;
  for (const tile of tiles) {
    if (!tile.type.startsWith("trans_")) continue;
    for (const [tr, tc] of tile.cells) if (tr === r && tc === c) return true;
  }
  return false;
}

/**
 * BFS 在道路格上找 home→dest 的路径，返回世界坐标折线。
 *
 * 走 4 邻域（曼哈顿），因为路网本身是正交的；8 邻域会让斜穿街角。
 * 找不到路（没铺路 / 两端不在路上）时返回 null，调用方退回 L 形。
 */
export function findRoadPath(
  parcel: Parcel,
  tiles: Tile[],
  grid: { size: number; cell: number; originX: number; originZ: number },
  from: [number, number],
  to: [number, number],
): number[] | null {
  const size = grid.size;
  const key = (r: number, c: number) => r * size + c;
  const start = key(from[0], from[1]);
  const goal = key(to[0], to[1]);
  if (start === goal) return null;

  const prev = new Int32Array(size * size).fill(-2);
  prev[start] = -1;
  const queue: number[] = [start];
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const cur = queue[head++] as number;
    if (cur === goal) { found = true; break; }
    const r = Math.floor(cur / size);
    const c = cur % size;
    const neighbours = [
      [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1],
    ];
    for (const [nr, nc] of neighbours) {
      if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
      const nk = key(nr, nc);
      if (prev[nk] !== -2) continue;
      // 终点格本身可能是建筑，允许作为终点；中间必须可通行
      if (!isRoad(parcel, tiles, nr, nc) && nk !== goal) continue;
      prev[nk] = cur;
      queue.push(nk);
    }
  }
  if (!found) return null;

  const cells: [number, number][] = [];
  for (let cur = goal; cur !== -1; cur = prev[cur]) {
    cells.push([Math.floor(cur / size), cur % size]);
    if (cells.length > 96) break;
  }
  cells.reverse();
  const out: number[] = [];
  for (const [r, c] of cells) {
    const x = grid.originX + (c + 0.5) * grid.cell;
    const z = grid.originZ + (r + 0.5) * grid.cell;
    out.push(x, z);
  }
  return out;
}

export function cumulative(path: number[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i * 2 + 1 < path.length; i += 1) {
    const dx = path[i * 2] - path[(i - 1) * 2];
    const dz = path[i * 2 + 1] - path[(i - 1) * 2 + 1];
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  return cum;
}

/**
 * 给定归一化进度 t∈[0,1]，返回沿「home → corner → dest」折线的位置。
 *
 * 两段按真实长度加权，所以拐点处不会出现速度跳变 —— 这是「走 L 形街区」
 * 与「直线穿过建筑」的区别，也是这版移动逻辑的核心。
 */
export function agentPosition(
  agent: Pick<Agent, "hx" | "hz" | "dx" | "dz" | "cx" | "cz">,
  t: number,
): { x: number; z: number } {
  const clamped = Math.min(1, Math.max(0, t));
  const legA = Math.hypot(agent.cx - agent.hx, agent.cz - agent.hz);
  const legB = Math.hypot(agent.dx - agent.cx, agent.dz - agent.cz);
  const total = legA + legB || 1;
  const covered = clamped * total;
  if (covered <= legA) {
    const k = legA === 0 ? 0 : covered / legA;
    return { x: agent.hx + (agent.cx - agent.hx) * k, z: agent.hz + (agent.cz - agent.hz) * k };
  }
  const k = legB === 0 ? 0 : (covered - legA) / legB;
  return { x: agent.cx + (agent.dx - agent.cx) * k, z: agent.cz + (agent.dz - agent.cz) * k };
}

export function CitizenDots({
  parcel,
  tiles,
  population,
  existingCells,
}: {
  parcel: Parcel;
  tiles: Tile[];
  population: number;
  /** 真实片区既有建筑占用的格子（"r,c"）。玩家还没建住宅时，人从这里出发。 */
  existingCells?: Set<string>;
}) {
  const grid = useMemo(() => gridOf(parcel), [parcel]);
  // findRoadPath 需要世界坐标原点；cellToWorld 的内部换算等价于
  // origin = -(size * cell)/2
  const gridForPath = useMemo(
    () => ({
      size: grid.size,
      cell: grid.cell,
      originX: -(grid.size * grid.cell) / 2,
      originZ: -(grid.size * grid.cell) / 2,
    }),
    [grid],
  );
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const agents = useMemo<Agent[]>(() => {
    const playerHomes = tiles.filter((tile) => tile.type.startsWith("res_"));
    // 真实片区开局时玩家一栋住宅都没有，但城里住着几百万人。
    // 这时用既有建筑的占用格当出发点，否则整个画面一个人都不会出现。
    const existAnchors: [number, number][] = [];
    if (playerHomes.length === 0 && existingCells) {
      for (const key of existingCells) {
        const [r, c] = key.split(",").map(Number);
        if (Number.isFinite(r) && Number.isFinite(c)) existAnchors.push([r, c]);
        if (existAnchors.length >= 240) break;
      }
    }
    const homes: { id: string; anchor: [number, number] }[] =
      playerHomes.length > 0
        ? playerHomes.map((tile) => ({ id: tile.id, anchor: tile.anchor as [number, number] }))
        : existAnchors.map((anchor, index) => ({ id: `exist-${anchor[0]}-${anchor[1]}-${index}`, anchor }));
    if (homes.length === 0 || population <= 0) return [];

    const jobs = tiles.filter((tile) =>
      JOB_PREFIXES.some((prefix) => tile.type.startsWith(prefix)),
    );
    // 目的地优先取岗位；纯住宅区则去另一栋住宅，保证总有人在路上。
    // 既有片区没有岗位数据时，就在既有格里来回走 —— 通勤的样子要有。
    const destinations =
      jobs.length > 0
        ? jobs.map((tile) => ({ id: tile.id, anchor: tile.anchor as [number, number] }))
        : homes;

    const count = Math.max(
      MIN_AGENTS,
      Math.min(MAX_AGENTS, Math.round(population / (homes.length * 90)) * homes.length),
    );
    const out: Agent[] = [];
    for (let i = 0; i < count; i += 1) {
      const home = homes[i % homes.length];
      const seed = hash(`${home.id}:${i}`);
      // 既有人口没有岗位信息时，随机挑一个**不同的**既有格当目的地，
      // 否则 dest === home，人原地不动。
      let dest = destinations[seed % destinations.length];
      if (dest.id === home.id && destinations.length > 1) {
        dest = destinations[(seed + 7) % destinations.length];
      }
      const [hx, hz] = cellToWorld(grid, home.anchor[0], home.anchor[1]);
      const [dx, dz] = cellToWorld(grid, dest.anchor[0], dest.anchor[1]);
      // 同一格上的人错开一点，避免叠成一个点
      const spread = grid.cell * 0.28;
      const ox = (((seed >>> 3) & 15) / 15 - 0.5) * spread;
      const oz = (((seed >>> 7) & 15) / 15 - 0.5) * spread;
      const cx = (seed & 1) === 0 ? dx : hx;
      const cz = (seed & 1) === 0 ? hz : dz;
      // 沿道路走：BFS 找不到路（没铺路 / 端点不在路上）就退回 L 形
      const road = findRoadPath(parcel, tiles, gridForPath, home.anchor, dest.anchor);
      out.push({
        hx: hx + ox,
        hz: hz + oz,
        dx: dx + ox,
        dz: dz + oz,
        cx,
        cz,
        phase: ((seed >>> 11) & 1023) / 1023,
        speed: WALK_SPEED * (0.7 + ((seed >>> 17) & 7) / 7 * 0.6),
        ...(road
          ? { path: road, cum: cumulative(road) }
          : {}),
      });
    }
    return out;
  }, [tiles, population, grid]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || agents.length === 0) return;
    const time = state.clock.elapsedTime;
    // 贴路面：抬到建筑顶会像「悬浮的点」，人应该在地面层可见
    const y = grid.cell * 0.09;
    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i];
      // 0..2 往返：0→1 去程，1→2 回程
      const cycle = (time * agent.speed + agent.phase) % 2;
      const forward = cycle <= 1;
      const t = forward ? cycle : 2 - cycle;

      const { x, z } =
        agent.path && agent.cum && agent.cum.length > 1
          ? pathPosition(agent.path, agent.cum, t)
          : agentPosition(agent, t);

      dummy.position.set(x, y, z);
      // 走动时上下轻微起伏，远看像步行而不是滑行
      dummy.position.y = y + Math.abs(Math.sin(time * 6 + agent.phase * 6.28)) * grid.cell * 0.02;
      // 朝向取「下一帧位置 - 当前位置」，沿路径时自然朝行进方向
      const ahead = Math.min(1, t + 0.01);
      const np =
        agent.path && agent.cum && agent.cum.length > 1
          ? pathPosition(agent.path, agent.cum, ahead)
          : agentPosition(agent, ahead);
      dummy.rotation.y = Math.atan2(
        forward ? np.x - x : x - np.x,
        forward ? np.z - z : z - np.z,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = agents.length;
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (agents.length === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, agents.length]} frustumCulled={false}>
      <sphereGeometry args={[grid.cell * 0.055, 6, 6]} />
      <meshBasicMaterial color="#FFE29A" />
    </instancedMesh>
  );
}
