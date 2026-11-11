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
  /** L 形折线的拐点（先横后纵或先纵后横，按哈希定） */
  cx: number;
  cz: number;
  phase: number;
  speed: number;
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
}: {
  parcel: Parcel;
  tiles: Tile[];
  population: number;
}) {
  const grid = useMemo(() => gridOf(parcel), [parcel]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const agents = useMemo<Agent[]>(() => {
    const homes = tiles.filter((tile) => tile.type.startsWith("res_"));
    if (homes.length === 0 || population <= 0) return [];
    const jobs = tiles.filter((tile) =>
      JOB_PREFIXES.some((prefix) => tile.type.startsWith(prefix)),
    );
    // 目的地优先取岗位；纯住宅区则去另一栋住宅，保证总有人在路上
    const destinations = jobs.length > 0 ? jobs : homes;

    const count = Math.max(
      MIN_AGENTS,
      Math.min(MAX_AGENTS, Math.round(population / (homes.length * 90)) * homes.length),
    );
    const out: Agent[] = [];
    for (let i = 0; i < count; i += 1) {
      const home = homes[i % homes.length];
      const seed = hash(`${home.id}:${i}`);
      const dest = destinations[seed % destinations.length];
      const [hx, hz] = cellToWorld(grid, home.anchor[0], home.anchor[1]);
      const [dx, dz] = cellToWorld(grid, dest.anchor[0], dest.anchor[1]);
      // 同一格上的人错开一点，避免叠成一个点
      const spread = grid.cell * 0.28;
      const ox = (((seed >>> 3) & 15) / 15 - 0.5) * spread;
      const oz = (((seed >>> 7) & 15) / 15 - 0.5) * spread;
      const cx = (seed & 1) === 0 ? dx : hx;
      const cz = (seed & 1) === 0 ? hz : dz;
      out.push({
        hx: hx + ox,
        hz: hz + oz,
        dx: dx + ox,
        dz: dz + oz,
        cx,
        cz,
        phase: ((seed >>> 11) & 1023) / 1023,
        speed: WALK_SPEED * (0.7 + ((seed >>> 17) & 7) / 7 * 0.6),
      });
    }
    return out;
  }, [tiles, population, grid]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || agents.length === 0) return;
    const time = state.clock.elapsedTime;
    const y = 2.4;
    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i];
      // 0..2 往返：0→1 去程，1→2 回程
      const cycle = (time * agent.speed + agent.phase) % 2;
      const forward = cycle <= 1;
      const t = forward ? cycle : 2 - cycle;

      const { x, z } = agentPosition(agent, t);

      dummy.position.set(x, y, z);
      // 走动时上下轻微起伏，远看像步行而不是滑行
      dummy.position.y = y + Math.abs(Math.sin(time * 6 + agent.phase * 6.28)) * 0.18;
      dummy.rotation.y = Math.atan2(
        forward ? agent.dx - agent.cx : agent.hx - agent.cx,
        forward ? agent.dz - agent.cz : agent.hz - agent.cz,
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
