"use client";

/**
 * 场景分层（11 §6.2）：地形层、林木层、既有建筑占位层、玩家建筑层、悬停与放置预览层。
 * 合批策略：地形 1 mesh；水面 1；网格线 1；林木 1 InstancedMesh；
 * 既有建筑占位 1 InstancedMesh；玩家建筑按区块类型各 1 InstancedMesh（≤14）。
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Cell, Parcel, Tile, TileType } from "@/lib/contract";
import { EXISTING_FACES, SCENE_COLORS } from "@/lib/palette";
import { heightExaggeration } from "@saves/lib/scene";
import {
  TERRAIN_HEIGHT,
  cellToWorld,
  footprintCells,
  gridOf,
  tileTransform,
  worldToCell,
} from "./coords";
import { buildTerrain } from "./terrainGeometry";
import { cellFrameGeometry, tileGeometry, treeGeometry } from "./tileModels";
import { toonMaterial } from "./toon";
import { useGame } from "@/store/game";

const tmp = new THREE.Object3D();

/** 13 §1.4：树冠 2–3 种绿色随机（实例色与模型顶点色相乘） */
const TREE_TINTS = [
  new THREE.Color("#ffffff"),
  new THREE.Color("#c9ecc0"),
  new THREE.Color("#e6f5b0"),
];

/* ------------------------------------------------------------------ 地形 */

export interface PickHandlers {
  onHover: (cell: Cell | null) => void;
  onPick: (cell: Cell) => void;
}

export function TerrainLayer({
  parcel,
  onHover,
  onPick,
}: { parcel: Parcel } & PickHandlers) {
  const g = gridOf(parcel);
  const geo = useMemo(() => buildTerrain(parcel), [parcel]);
  const groundMat = useMemo(() => toonMaterial({ vertexColors: true }), []);
  const waterMat = useMemo(
    () =>
      toonMaterial({
        color: SCENE_COLORS.water,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [],
  );
  const gridMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: SCENE_COLORS.grid,
        transparent: true,
        opacity: 0.08,
      }),
    [],
  );
  useLayoutEffect(
    () => () => {
      geo.ground.dispose();
      geo.water?.dispose();
      geo.grid.dispose();
    },
    [geo],
  );

  // 地面拾取：先把世界命中点换回沙盘局部坐标（全域模式下沙盘被平移到 CBD 片区），
  // 命中顶面直接换算；命中侧壁时沿法线反向退半米，归属到更高的那一格
  const cellOf = (e: ThreeEvent<PointerEvent | MouseEvent>): Cell | null => {
    const p = e.object.worldToLocal(e.point.clone());
    const n = e.face?.normal;
    if (n && Math.abs(n.y) < 0.5) p.addScaledVector(n, -0.5);
    return worldToCell(g, p.x, p.z);
  };

  return (
    <group>
      <mesh
        geometry={geo.ground}
        material={groundMat}
        receiveShadow
        onPointerMove={(e) => {
          e.stopPropagation();
          onHover(cellOf(e));
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          // 拖动视角结束时也会触发 click：位移超过 4px 视为拖动，不算点选（防误触）
          if (e.delta > 4) return;
          const cell = cellOf(e);
          if (cell) onPick(cell);
        }}
      />
      {geo.water && (
        // 抬 4cm + polygonOffset：否则与地形顶面共面，深度测试在浮点误差下
        // 逐帧翻转，河道会整片闪烁。
        <mesh
          geometry={geo.water}
          material={waterMat}
          position={[0, 0.04, 0]}
          renderOrder={1}
        />
      )}
      <lineSegments geometry={geo.grid} material={gridMat} />
    </group>
  );
}

/* ---------------------------------------------------------------- 林木 */

export function ForestLayer({
  parcel,
  tiles,
}: {
  parcel: Parcel;
  tiles: Tile[];
}) {
  const g = gridOf(parcel);
  const spots = useMemo(() => {
    const taken = new Set(
      tiles.flatMap((t) => t.cells.map(([r, c]) => r * g.size + c)),
    );
    const out: [number, number, number][] = [];
    parcel.terrain.forEach((row, r) =>
      row.forEach((t, c) => {
        if (t !== "forest" || taken.has(r * g.size + c)) return;
        const j = (k: number) =>
          (((Math.sin(r * 12.9898 + c * 78.233 + k) * 43758.5453) % 1) + 1) % 1;
        out.push([
          r + 0.28 + j(1) * 0.12,
          c + 0.3 + j(2) * 0.12,
          0.85 + j(3) * 0.3,
        ]);
        out.push([
          r + 0.68 + j(4) * 0.1,
          c + 0.66 + j(5) * 0.12,
          0.75 + j(6) * 0.3,
        ]);
      }),
    );
    return out;
  }, [parcel, tiles, g.size]);
  const geometry = useMemo(() => treeGeometry(), []);
  const material = useMemo(() => toonMaterial({ vertexColors: true }), []);
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    spots.forEach(([r, c, k], i) => {
      const [x, z] = cellToWorld(g, r - 0.5, c - 0.5);
      tmp.position.set(x, 0, z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.setScalar(k);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      mesh.setColorAt(i, TREE_TINTS[i % TREE_TINTS.length]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [spots, g]);

  if (!spots.length) return null;
  return (
    <instancedMesh
      key={spots.length}
      ref={ref}
      args={[geometry, material, spots.length]}
      castShadow
      receiveShadow
    />
  );
}

/* ------------------------------------------------ 既有建筑占位（v1.1 occupied） */

/** 真实片区的 OSM 建筑由 PR-28 渲染；这里只给 occupied 格一个浅色体块占位（16 §3.4 既有建筑浅色底景） */
export function OccupiedLayer({ parcel }: { parcel: Parcel }) {
  const g = gridOf(parcel);
  const cells = useMemo(() => {
    const out: Cell[] = [];
    parcel.terrain.forEach((row, r) =>
      row.forEach((t, c) => t === "occupied" && out.push([r, c])),
    );
    return out;
  }, [parcel]);
  const geometry = useMemo(
    () =>
      new THREE.BoxGeometry(g.cell * 0.8, 12, g.cell * 0.8).translate(0, 6, 0),
    [g.cell],
  );
  const material = useMemo(
    () => toonMaterial({ color: EXISTING_FACES.residential.m }),
    [],
  );
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    cells.forEach(([r, c], i) => {
      const [x, z] = cellToWorld(g, r, c);
      tmp.position.set(x, 0, z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1 + ((r * 7 + c * 13) % 5) * 0.4, 1);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [cells, g]);

  if (!cells.length) return null;
  return (
    <instancedMesh
      key={cells.length}
      ref={ref}
      args={[geometry, material, cells.length]}
      castShadow
      receiveShadow
    />
  );
}

/* ------------------------------------------------------------ 玩家建筑 */

function setTileMatrix(
  mesh: THREE.InstancedMesh,
  i: number,
  parcel: Parcel,
  tile: Pick<Tile, "type" | "cells" | "orientation">,
) {
  const t = tileTransform(gridOf(parcel), parcel, tile);
  // 与既有建筑同一套高度夸张，否则 48km 棋盘上新建的楼只是一层贴地的皮，看不见
  const exagg = heightExaggeration(parcel.size * parcel.cell_size_m);
  tmp.position.set(t.x, t.base, t.z);
  tmp.rotation.set(0, t.vertical ? Math.PI / 2 : 0, 0);
  tmp.scale.set(tile.type === "util_bridge" ? t.span : 1, exagg, 1);
  tmp.updateMatrix();
  mesh.setMatrixAt(i, tmp.matrix);
}

function TileTypeMesh({
  parcel,
  type,
  tiles,
  material,
  tint,
}: {
  parcel: Parcel;
  type: TileType;
  tiles: Tile[];
  material: THREE.Material;
  tint: string | null;
}) {
  const geometry = useMemo(
    () => tileGeometry(type, parcel.cell_size_m, tint),
    [type, parcel.cell_size_m, tint],
  );
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    // 拆房后 tiles 变少：InstancedMesh 的 count 是构造时定的，
    // 不显式改回来就会继续渲染旧的实例矩阵（拆掉的楼留在原地）。
    mesh.count = tiles.length;
    tiles.forEach((tile, i) => setTileMatrix(mesh, i, parcel, tile));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [tiles, parcel]);
  // key 绑定数量：tiles 增减时重建实例缓冲，避免复用旧容量
  return (
    <instancedMesh
      key={tiles.length}
      ref={ref}
      args={[geometry, material, Math.max(1, tiles.length)]}
      castShadow
      receiveShadow
    />
  );
}

/** 全城指标 → 视图色（0 差 → 1 好） */
function infoTint(
  view: string,
  metrics: {
    land_price_index: number;
    pollution: number;
    congestion: number;
    happiness?: number;
    jobs?: number;
    population?: number;
  } | null,
): string | null {
  if (view === "default" || !metrics) return null;
  if (view === "landprice") {
    const v = Math.max(0, Math.min(1, metrics.land_price_index / 100));
    // 绿 → 黄 → 红
    return v > 0.66 ? "#3DD68C" : v > 0.33 ? "#FFC93C" : "#FF4F5E";
  }
  if (view === "pollution") {
    // pollution 契约是 0..1（不是百分数）
    const v = Math.max(0, Math.min(1, metrics.pollution));
    return v > 0.5 ? "#8B5A2B" : v > 0.25 ? "#C9A227" : "#7CCBFF";
  }
  if (view === "happiness") {
    const v = Math.max(0, Math.min(1, (metrics.happiness ?? 50) / 100));
    return v > 0.66 ? "#3DD68C" : v > 0.4 ? "#FFC93C" : "#FF4F5E";
  }
  if (view === "jobs") {
    const ratio = (metrics.jobs ?? 0) / Math.max(1, metrics.population ?? 1);
    const v = Math.max(0, Math.min(1, ratio));
    return v > 0.8 ? "#3DD68C" : v > 0.5 ? "#FFC93C" : "#FF4F5E";
  }
  // congestion 契约是「路网负载 / 容量」，多数情况 0..1（BPR 下可略超 1）
  const v = Math.max(0, Math.min(1, metrics.congestion));
  return v > 0.6 ? "#FF4F5E" : v > 0.3 ? "#FFB020" : "#3CCB6E";
}

export function TileLayer({
  parcel,
  tiles,
}: {
  parcel: Parcel;
  tiles: Tile[];
}) {
  const material = useMemo(() => toonMaterial({ vertexColors: true }), []);
  const infoView = useGame((s) => s.infoView);
  const metrics = useGame((s) => s.metrics);
  const tint = infoTint(infoView, metrics);
  const groups = useMemo(() => {
    const m = new Map<TileType, Tile[]>();
    for (const t of tiles) {
      const list = m.get(t.type);
      if (list) list.push(t);
      else m.set(t.type, [t]);
    }
    return [...m.entries()];
  }, [tiles]);
  return (
    <group>
      {groups.map(([type, list]) => (
        // 数量变化时以新 key 重建 InstancedMesh（实例容量在构造时固定）
        <TileTypeMesh
          key={`${type}:${list.length}:${tint ?? "base"}`}
          parcel={parcel}
          type={type}
          tiles={list}
          material={material}
          tint={tint}
        />
      ))}
    </group>
  );
}

/* ---------------------------------------------------- 服务覆盖圈 */

/**
 * 学校 / 医院的服务半径圈（C:S 的「服务覆盖」视图）。
 * 半径与后端 coverage.py 的 COVERAGE_RADIUS_M = 600 保持一致，
 * 否则玩家看到的圈和算出来的覆盖率会对不上。
 */
export function ServiceRings({ parcel, tiles }: { parcel: Parcel; tiles: Tile[] }) {
  const grid = gridOf(parcel);
  const rings = useMemo(() => {
    const out: { x: number; z: number; radius: number; color: string }[] = [];
    for (const tile of tiles) {
      if (tile.type !== "edu_school" && tile.type !== "med_clinic") continue;
      const [x, z] = cellToWorld(grid, tile.anchor[0], tile.anchor[1]);
      out.push({
        x,
        z,
        radius: 600,
        color: tile.type === "edu_school" ? "#3D8BFF" : "#FF5C7A",
      });
    }
    return out;
  }, [grid, tiles]);

  if (rings.length === 0) return null;
  return (
    <group>
      {rings.map((ring, i) => (
        <mesh
          key={`${ring.x}:${ring.z}:${i}`}
          position={[ring.x, 1.2, ring.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[ring.radius - 8, ring.radius, 72]} />
          <meshBasicMaterial
            color={ring.color}
            transparent
            opacity={0.45}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------------------------------------------- 悬停与放置预览 */

export interface GhostSpec {
  type: TileType;
  anchor: Cell;
  /** 实际覆盖格；缺省按目录占地从锚点展开 */
  cells?: Cell[];
  orientation?: Tile["orientation"];
  valid: boolean;
}

function cellTop(parcel: Parcel, r: number, c: number) {
  const t = parcel.terrain[r]?.[c] ?? "flat";
  return Math.max(0, TERRAIN_HEIGHT[t]);
}

export function HoverFrame({
  parcel,
  cell,
}: {
  parcel: Parcel;
  cell: Cell | null;
}) {
  const geometry = useMemo(
    () => cellFrameGeometry(parcel.cell_size_m),
    [parcel.cell_size_m],
  );
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SCENE_COLORS.hover,
        vertexColors: true,
      }),
    [],
  );
  if (!cell) return null;
  const [x, z] = cellToWorld(gridOf(parcel), cell[0], cell[1]);
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[x, cellTop(parcel, cell[0], cell[1]) + 0.4, z]}
    />
  );
}

export function GhostLayer({
  parcel,
  ghost,
}: {
  parcel: Parcel;
  ghost: GhostSpec | null;
}) {
  const g = gridOf(parcel);
  const frameGeo = useMemo(
    () => cellFrameGeometry(parcel.cell_size_m),
    [parcel.cell_size_m],
  );
  const frameMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
      }),
    [],
  );
  const ghostMat = useMemo(
    () =>
      // 16 §5.1：放置预览用有序抖动（alphaHash）代替半透明，像素风的「半透明」
      toonMaterial({
        vertexColors: true,
        alphaHash: true,
        opacity: 0.55,
      }),
    [],
  );
  const ghostMesh = useRef<THREE.InstancedMesh>(null);
  const frames = useRef<THREE.InstancedMesh>(null);
  const cells = useMemo(
    () =>
      (ghost
        ? (ghost.cells ?? footprintCells(ghost.type, ghost.anchor))
        : []
      ).filter(([r, c]) => r >= 0 && c >= 0 && r < g.size && c < g.size),
    [ghost, g.size],
  );

  useLayoutEffect(() => {
    if (!ghost) return;
    const fm = frames.current;
    if (fm) {
      const color = new THREE.Color(
        ghost.valid ? SCENE_COLORS.valid : SCENE_COLORS.invalid,
      );
      cells.forEach(([r, c], i) => {
        const [x, z] = cellToWorld(g, r, c);
        tmp.position.set(x, cellTop(parcel, r, c) + 0.5, z);
        tmp.rotation.set(0, 0, 0);
        tmp.scale.set(1, 1, 1);
        tmp.updateMatrix();
        fm.setMatrixAt(i, tmp.matrix);
        fm.setColorAt(i, color);
      });
      fm.instanceMatrix.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
      fm.computeBoundingSphere();
    }
    const gm = ghostMesh.current;
    if (gm && cells.length) {
      setTileMatrix(gm, 0, parcel, {
        type: ghost.type,
        cells,
        orientation: ghost.orientation,
      });
      gm.instanceMatrix.needsUpdate = true;
      gm.computeBoundingSphere();
    }
  }, [ghost, cells, parcel, g]);

  if (!ghost || !cells.length) return null;
  return (
    <group>
      <instancedMesh
        key={`ghost:${ghost.type}`}
        ref={ghostMesh}
        args={[tileGeometry(ghost.type, parcel.cell_size_m), ghostMat, 1]}
        renderOrder={2}
      />
      <instancedMesh
        key={`frames:${cells.length}`}
        ref={frames}
        args={[frameGeo, frameMat, cells.length]}
        renderOrder={3}
      />
    </group>
  );
}

/** 任意格框高亮（拆除模式选中区块等），一个 InstancedMesh */
export function CellFrames({
  parcel,
  cells,
  color,
}: {
  parcel: Parcel;
  cells: Cell[];
  color: string;
}) {
  const g = gridOf(parcel);
  const geometry = useMemo(
    () => cellFrameGeometry(parcel.cell_size_m),
    [parcel.cell_size_m],
  );
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ vertexColors: true }),
    [],
  );
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const c3 = new THREE.Color(color);
    cells.forEach(([r, c], i) => {
      const [x, z] = cellToWorld(g, r, c);
      tmp.position.set(x, cellTop(parcel, r, c) + 0.6, z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1.04, 1, 1.04);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, c3);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [cells, color, parcel, g]);
  if (!cells.length) return null;
  return (
    <instancedMesh
      key={cells.length}
      ref={ref}
      args={[geometry, material, cells.length]}
      renderOrder={3}
    />
  );
}


/** 可建空地高亮：建造模式下把能落的格子铺一层淡绿，解决"全城都是楼、找不到空地" */
export function BuildableLayer({
  parcel,
  tiles,
  existing,
}: {
  parcel: Parcel;
  tiles: Tile[];
  existing: Set<string>;
}) {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#3f8f4f",
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [],
  );
  const cells = useMemo(() => {
    const occ = new Set<string>();
    for (const t of tiles) for (const [r, c] of t.cells) occ.add(`${r}:${c}`);
    const out: [number, number][] = [];
    for (let r = 0; r < parcel.size; r++) {
      for (let c = 0; c < parcel.size; c++) {
        const key = `${r}:${c}`;
        if (parcel.terrain[r]?.[c] !== "flat") continue;
        if (occ.has(key) || existing.has(key)) continue;
        out.push([r, c]);
      }
    }
    return out;
  }, [parcel, tiles, existing]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const g = gridOf(parcel);
    const size = parcel.cell_size_m * 0.82;
    cells.forEach(([r, c], i) => {
      const [x, z] = cellToWorld(g, r, c);
      tmp.position.set(x, 3, z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(size, 1, size);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [cells, parcel]);
  if (cells.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, cells.length]} renderOrder={1} />;
}

/** 公共交通线路（C:S 的 TransportLine）：站间连线，颜色随线路。 */
export function TransitLines({
  parcel,
  tiles,
  transit,
}: {
  parcel: Parcel;
  tiles: Tile[];
  transit: { lid: number; color: string; stops: string[] }[];
}) {
  const grid = gridOf(parcel);
  const segments = useMemo(() => {
    const anchors = new Map(tiles.map((tile) => [tile.id, tile.anchor]));
    const out: { key: string; x: number; z: number; len: number; angle: number; color: string }[] = [];
    for (const line of transit) {
      const points = line.stops
        .map((id) => anchors.get(id))
        .filter((anchor): anchor is [number, number] => Boolean(anchor));
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1]!;
        const next = points[i]!;
        const [x1, z1] = cellToWorld(grid, prev[0], prev[1]);
        const [x2, z2] = cellToWorld(grid, next[0], next[1]);
        const dx = x2 - x1;
        const dz = z2 - z1;
        out.push({
          key: `${line.lid}-${i}`,
          x: (x1 + x2) / 2,
          z: (z1 + z2) / 2,
          len: Math.hypot(dx, dz),
          angle: Math.atan2(dx, dz),
          color: line.color,
        });
      }
    }
    return out;
  }, [grid, tiles, transit]);

  if (segments.length === 0) return null;
  return (
    <group>
      {segments.map((segment) => (
        <mesh
          key={segment.key}
          position={[segment.x, 2.0, segment.z]}
          rotation={[0, segment.angle, 0]}
        >
          <boxGeometry args={[6, 0.6, segment.len]} />
          <meshBasicMaterial color={segment.color} transparent opacity={0.75} />
        </mesh>
      ))}
    </group>
  );
}
