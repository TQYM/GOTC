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
        <mesh geometry={geo.water} material={waterMat} renderOrder={1} />
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
  tmp.position.set(t.x, t.base, t.z);
  tmp.rotation.set(0, t.vertical ? Math.PI / 2 : 0, 0);
  tmp.scale.set(tile.type === "util_bridge" ? t.span : 1, 1, 1);
  tmp.updateMatrix();
  mesh.setMatrixAt(i, tmp.matrix);
}

function TileTypeMesh({
  parcel,
  type,
  tiles,
  material,
}: {
  parcel: Parcel;
  type: TileType;
  tiles: Tile[];
  material: THREE.Material;
}) {
  const geometry = useMemo(
    () => tileGeometry(type, parcel.cell_size_m),
    [type, parcel.cell_size_m],
  );
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    tiles.forEach((tile, i) => setTileMatrix(mesh, i, parcel, tile));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [tiles, parcel]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, tiles.length]}
      castShadow
      receiveShadow
    />
  );
}

export function TileLayer({
  parcel,
  tiles,
}: {
  parcel: Parcel;
  tiles: Tile[];
}) {
  const material = useMemo(() => toonMaterial({ vertexColors: true }), []);
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
          key={`${type}:${list.length}`}
          parcel={parcel}
          type={type}
          tiles={list}
          material={material}
        />
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
