"use client";

/**
 * 街景层：随机活动的像素风小人与小车（PR-39）。
 *
 * - 小人/小车沿真实道路 polyline 流动，端点处随机换路（有「走远再回来」的感觉）；
 * - 方向对齐路径切线，小人 billboard 朝向相机（保持像素贴图清晰）；
 * - 数量与速度随玩家行为变化：人口→小人密度、岗位→车流、拥堵→车速、幸福度→步态；
 * - 玩家新建的道路 tile 会并入路网，车流明显增多。
 *
 * 性能：小人 3 个 InstancedMesh（三种配色贴图）、车 1 个 InstancedMesh，
 * 全部单 draw call；440 个实例每帧更新矩阵，桌面无压力。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Tile } from "@/lib/contract";
import type { NetworkFile } from "@saves/lib/types";
import { withBase } from "@/lib/api/base";

interface Props {
  worldSize: number;
  networkUrl: string | null;
  cellSize: number;
  tiles: Tile[];
  population: number;
  jobs: number;
  congestion: number;
  happiness: number;
  /** 世界尺度系数：棋盘越大，小人 / 小车按比例放大（48km 棋盘约 3 倍） */
  scale?: number;
}

interface PathData {
  pts: THREE.Vector3[];
  segLengths: number[];
  total: number;
}

interface Mover {
  path: number;
  seg: number;
  t: number;
  speed: number;
  lateral: number;
}

const MAX_WALKERS = 360;
const MAX_CARS = 180;

const WALKER_PALETTES = [
  { hat: "#27313f", hair: "#1d1a17", skin: "#f0c49b", shirt: "#4c8dd8", pants: "#37455c", shoe: "#191c22" },
  { hat: "#8f3b30", hair: "#3a2a1d", skin: "#e8b98f", shirt: "#d4574b", pants: "#6b5a3e", shoe: "#221c17" },
  { hat: "#2f6b4f", hair: "#241c14", skin: "#f3cba4", shirt: "#e8b93f", pants: "#3f5063", shoe: "#1b1b1b" },
];

/** 画一个 10×16 的像素小人（白底形状 + 分色块），供 instanceColor 之外稳定着色 */
function makeWalkerTexture(p: (typeof WALKER_PALETTES)[number]): THREE.CanvasTexture {
  const w = 10;
  const h = 16;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return tex;
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  // 帽子
  for (let x = 2; x <= 7; x += 1) px(x, 0, p.hat);
  for (let x = 1; x <= 8; x += 1) px(x, 1, p.hat);
  // 头
  for (let y = 2; y <= 5; y += 1) for (let x = 2; x <= 7; x += 1) px(x, y, p.skin);
  px(3, 3, "#181820");
  px(6, 3, "#181820");
  // 头发边
  px(2, 2, p.hair);
  px(7, 2, p.hair);
  // 身体
  for (let y = 6; y <= 10; y += 1) for (let x = 2; x <= 7; x += 1) px(x, y, p.shirt);
  // 手臂
  for (let y = 6; y <= 9; y += 1) {
    px(1, y, p.shirt);
    px(8, y, p.shirt);
  }
  // 腿
  for (let y = 11; y <= 14; y += 1) {
    px(3, y, p.pants);
    px(4, y, p.pants);
    px(5, y, p.pants);
    px(6, y, p.pants);
  }
  // 鞋
  for (let x = 2; x <= 4; x += 1) px(x, 15, p.shoe);
  for (let x = 5; x <= 7; x += 1) px(x, 15, p.shoe);

  tex.needsUpdate = true;
  return tex;
}

function makePaths(file: NetworkFile, worldSize: number, tiles: Tile[], cellSize: number): PathData[] {
  const half = worldSize / 2;
  const result: PathData[] = [];
  const push = (points: [number, number][]) => {
    if (points.length < 2) return;
    const pts = points.map(([x, z]) => new THREE.Vector3(x - half, 0.9, z - half));
    const segLengths = [];
    let total = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const len = pts[i].distanceTo(pts[i - 1]);
      segLengths.push(len);
      total += len;
    }
    if (total > 1) result.push({ pts, segLengths, total });
  };

  for (const feature of file.features) {
    if (!feature.kind.includes("road")) continue;
    if (!Array.isArray(feature.path) || feature.path.length < 2) continue;
    push(feature.path as [number, number][]);
  }

  // 玩家新建的道路并入路网：每个道路 tile 生成一条 5 格长的直段（沿最近真实道路方向近似）
  for (const tile of tiles) {
    if (tile.type !== "trans_road") continue;
    const cells = tile.cells.length ? tile.cells : [tile.anchor];
    const rows = cells.map(([r]) => r);
    const cols = cells.map(([, c]) => c);
    const cx = (Math.min(...cols) + Math.max(...cols) + 1) * 0.5 * cellSize - half;
    const cz = (Math.min(...rows) + Math.max(...rows) + 1) * 0.5 * cellSize - half;
    const span = 2.5 * cellSize;
    push([
      [cx - span, cz],
      [cx + span, cz],
    ]);
  }

  return result;
}

function pickPath(paths: PathData[], rnd: () => number): number {
  return Math.floor(rnd() * paths.length) % paths.length;
}

function initMovers(count: number, paths: PathData[], baseSpeed: number): Mover[] {
  const movers: Mover[] = [];
  let seed = 20261108;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i += 1) {
    const path = pickPath(paths, rnd);
    const seg = Math.floor(rnd() * Math.max(1, paths[path].pts.length - 1));
    movers.push({
      path,
      seg,
      t: rnd(),
      speed: baseSpeed * (0.7 + rnd() * 0.6),
      lateral: (rnd() - 0.5) * 3.2,
    });
  }
  return movers;
}

export default function AmbientTraffic({
  worldSize,
  networkUrl,
  cellSize,
  tiles,
  population,
  jobs,
  congestion,
  happiness,
  scale = 1,
}: Props) {
  const { camera } = useThree();
  const [network, setNetwork] = useState<NetworkFile | null>(null);

  useEffect(() => {
    if (!networkUrl) return;
    const controller = new AbortController();
    void fetch(withBase(networkUrl), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NetworkFile | null) => {
        if (!controller.signal.aborted && data) setNetwork(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [networkUrl]);

  const paths = useMemo(
    () => (network ? makePaths(network, worldSize, tiles, cellSize) : []),
    [network, worldSize, tiles, cellSize],
  );

  const walkerCount = Math.max(0, Math.min(MAX_WALKERS, Math.round(population / 40) || 8));
  const carCount = Math.max(0, Math.min(MAX_CARS, Math.round(jobs / 130) || 4));
  // congestion 是 0..1 的负载比，不是百分数
  const speedScale = Math.max(0.35, 1 - Math.min(1, congestion) * 0.6);
  const moodScale = happiness >= 58 ? 1.12 : happiness >= 42 ? 1 : 0.66;

  // 三个配色的 instanced mesh
  const walkerGroups = useRef<(THREE.InstancedMesh | null)[]>([]);
  const carMesh = useRef<THREE.InstancedMesh | null>(null);
  const walkers = useRef<Mover[]>([]);
  const cars = useRef<Mover[]>([]);
  const walkerVersion = useRef(-1);
  const carVersion = useRef(-1);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const carColorApplied = useRef(false);

  const walkerTextures = useMemo(
    () => (typeof document === "undefined" ? [] : WALKER_PALETTES.map(makeWalkerTexture)),
    [],
  );

  useEffect(
    () => () => {
      for (const tex of walkerTextures) tex.dispose();
    },
    [walkerTextures],
  );

  // 载入/路网变化时重建 mover 池
  useEffect(() => {
    if (!paths.length) return;
    walkers.current = initMovers(walkerCount, paths, 9);
    walkerVersion.current = -1;
    cars.current = initMovers(carCount, paths, 26);
    carVersion.current = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  useEffect(() => {
    if (!paths.length) return;
    if (walkers.current.length !== walkerCount) {
      walkers.current = initMovers(walkerCount, paths, 9);
      walkerVersion.current = -1;
    }
  }, [walkerCount, paths]);

  useEffect(() => {
    if (!paths.length) return;
    if (cars.current.length !== carCount) {
      cars.current = initMovers(carCount, paths, 26);
      carVersion.current = -1;
    }
  }, [carCount, paths]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const camQuat = camera.quaternion;

    if (walkers.current.length && paths.length) {
      const perGroup = Math.ceil(walkers.current.length / 3);
      let moved = false;
      walkers.current.forEach((mover) => {
        moved = updateMover(mover, paths, dt, 9 * speedScale * moodScale) || moved;
      });
      if (moved) walkerVersion.current += 1;
      for (let g = 0; g < 3; g += 1) {
        const mesh = walkerGroups.current[g];
        if (!mesh) continue;
        const slice = walkers.current.slice(g * perGroup, (g + 1) * perGroup);
        mesh.count = slice.length;
        for (let i = 0; i < slice.length; i += 1) {
          const { position, yaw } = sampleMover(slice[i], paths);
          // 小人贴图是「脚在底边」的 billboard：中心要抬到身高一半，否则下半身埋进地表
          dummy.position.set(
            position.x,
            position.y + (2.6 * scale) / 2,
            position.z,
          );
          dummy.rotation.set(0, yaw, 0);
          dummy.quaternion.copy(camQuat);
          dummy.rotateY(Math.PI);
          dummy.scale.setScalar(2.6 * scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    }

    if (cars.current.length && paths.length && carMesh.current) {
      const mesh = carMesh.current;
      cars.current.forEach((mover) => updateMover(mover, paths, dt, 26 * speedScale));
      mesh.count = cars.current.length;
      for (let i = 0; i < cars.current.length; i += 1) {
        const { position, yaw } = sampleMover(cars.current[i], paths);
        // 车身 1.4 高，中心抬到 0.7×倍率
        dummy.position.set(
          position.x,
          position.y + (1.4 * scale) / 2,
          position.z,
        );
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.setScalar(1.7 * scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (!carColorApplied.current) {
        const colors = ["#e8e6e0", "#d94f45", "#3f7fd9", "#e0b23c", "#3f3f46", "#5aa469", "#c46bd3"];
        const color = new THREE.Color();
        for (let i = 0; i < MAX_CARS; i += 1) {
          color.set(colors[i % colors.length]);
          mesh.setColorAt(i, color);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        carColorApplied.current = true;
      }
    }
  });

  return (
    <group name="ambient-traffic">
      {walkerTextures.map((texture, index) => (
        <instancedMesh
          key={index}
          ref={(node) => {
            walkerGroups.current[index] = node;
          }}
          args={[undefined, undefined, MAX_WALKERS]}
          frustumCulled={false}
          renderOrder={3}
        >
          <planeGeometry args={[1, 1.6]} />
          <meshBasicMaterial
            map={texture}
            transparent
            alphaTest={0.45}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </instancedMesh>
      ))}

      <instancedMesh
        ref={(node) => {
          carMesh.current = node;
        }}
        args={[undefined, undefined, MAX_CARS]}
        frustumCulled={false}
        renderOrder={3}
      >
        <boxGeometry args={[4.6, 1.4, 2.0]} />
        <meshStandardMaterial roughness={0.55} metalness={0.15} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/** 推进一个 mover，返回是否发生了换路/跳段 */
function updateMover(mover: Mover, paths: PathData[], dt: number, speed: number): boolean {
  const path = paths[mover.path];
  if (!path) return false;
  const segLength = path.segLengths[mover.seg] ?? 1;
  const advance = (mover.speed * speed * dt) / Math.max(1, segLength);
  let jumped = false;
  mover.t += advance;
  while (mover.t >= 1) {
    mover.t -= 1;
    mover.seg += 1;
    if (mover.seg >= path.segLengths.length) {
      mover.path = Math.floor(Math.random() * paths.length);
      mover.seg = 0;
      mover.t = Math.random();
      jumped = true;
      break;
    }
  }
  return jumped;
}

/** 采样位置与朝向（含轻微横向偏移，避免所有人挤在路中心线上） */
function sampleMover(mover: Mover, paths: PathData[]): { position: THREE.Vector3; yaw: number } {
  const path = paths[mover.path];
  const a = path.pts[mover.seg] ?? path.pts[0];
  const b = path.pts[mover.seg + 1] ?? a;
  const position = new THREE.Vector3().lerpVectors(a, b, mover.t);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const yaw = Math.atan2(dx, dz);
  position.x += Math.cos(yaw) * mover.lateral * 0.4;
  position.z += Math.sin(yaw) * mover.lateral * 0.4;
  return { position, yaw };
}
