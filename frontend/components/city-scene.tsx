"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Object3D } from "three";
import type { InstancedMesh, Mesh, MeshBasicMaterial } from "three";
import {
  bridgePlacementCells,
  cellToWorld,
  createExistingAssetChunks,
  createExistingBuildingGeometries,
  createNetworkGeometries,
  createTerrainGeometries,
  getCellBounds,
  getPlacementCells,
  getTileSpan,
  getVisibleChunkKeys,
  mergeExistingBuildingLayers,
  terrainHeight,
  worldToCell,
} from "../lib/scene";
import type { CellBounds, WorldPoint } from "../lib/scene";
import type {
  Anchor,
  BuildingsFile,
  ExistingAsset,
  NetworkFile,
  Parcel,
  Terrain,
  Tile,
  TileType,
  Tool,
} from "../lib/types";

export interface CitySceneProps {
  parcel: Parcel;
  tiles: Tile[];
  redevelopedAssetIds: string[];
  buildingsUrl: string | null;
  networkUrl: string | null;
  tool: Tool;
  selectedType: TileType;
  orientation?: "horizontal" | "vertical";
  onCellAction: (anchor: Anchor) => void;
  pulse?: { seq: number; anchor: Anchor } | null;
}

interface RemoteFileState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useRemoteFile<T>(url: string | null): RemoteFileState<T> {
  const [state, setState] = useState<RemoteFileState<T>>({
    data: null,
    loading: url !== null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    if (url === null) {
      setState({ data: null, loading: false, error: null });
      return () => controller.abort();
    }

    setState({ data: null, loading: true, error: null });
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as T;
        if (!controller.signal.aborted) setState({ data, loading: false, error: null });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : "未知错误",
        });
      }
    })();

    return () => controller.abort();
  }, [url]);

  return state;
}

interface TerrainLayerProps {
  parcel: Parcel;
  onHover: (point: WorldPoint) => void;
  onLeave: () => void;
  onSelect: (point: WorldPoint, dragDistance: number) => void;
}

function TerrainLayer({ parcel, onHover, onLeave, onSelect }: TerrainLayerProps) {
  const geometries = useMemo(() => createTerrainGeometries(parcel), [parcel]);
  useEffect(() => () => {
    geometries.solid.dispose();
    geometries.water?.dispose();
  }, [geometries]);

  const hover = (event: ThreeEvent<PointerEvent>) => {
    onHover([event.point.x, event.point.z]);
  };
  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect([event.point.x, event.point.z], event.delta);
  };

  return (
    <group onPointerMove={hover} onPointerOut={onLeave} onClick={select}>
      <mesh geometry={geometries.solid}>
        <meshStandardMaterial vertexColors flatShading roughness={0.95} />
      </mesh>
      {geometries.water && (
        <mesh geometry={geometries.water} renderOrder={1}>
          <meshStandardMaterial
            vertexColors
            transparent
            opacity={0.72}
            depthWrite={false}
            roughness={0.3}
            metalness={0.05}
          />
        </mesh>
      )}
    </group>
  );
}

const EXISTING_COLORS: Record<ExistingAsset["category"], string> = {
  residential: "#e8e6e1",
  workplace: "#d5d2cc",
  industrial: "#c4c0ba",
  civic: "#ddd9d1",
};

interface ExistingBuildingsProps {
  file: BuildingsFile;
  redevelopedAssetIds: string[];
  worldSize: number;
  cellSize: number;
}

function ExistingBuildings({
  file,
  redevelopedAssetIds,
  worldSize,
  cellSize,
}: ExistingBuildingsProps) {
  const chunks = useMemo(
    () => createExistingAssetChunks(file, redevelopedAssetIds, worldSize),
    [file, redevelopedAssetIds, worldSize],
  );
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const lastVisibilityCheck = useRef(-Infinity);
  // Data packs use 8×8-cell chunks: preload a one-chunk ring around the frustum.
  const neighborMargin = cellSize * 8;

  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - lastVisibilityCheck.current < 0.12) return;
    lastVisibilityCheck.current = clock.elapsedTime;
    const next = getVisibleChunkKeys(chunks, camera, neighborMargin);
    setVisibleKeys((previous) => (
      previous.length === next.length && previous.every((key, index) => key === next[index])
        ? previous
        : next
    ));
  });

  // A new cache per file/redevelopment revision avoids stale cleanup disposing new entries.
  const geometryCache = useMemo(
    () => new Map<string, ReturnType<typeof createExistingBuildingGeometries>>(),
    [chunks, worldSize],
  );
  useEffect(() => () => {
    for (const layers of geometryCache.values()) {
      for (const layer of layers) layer.geometry.dispose();
    }
    geometryCache.clear();
  }, [geometryCache]);

  const buildings = useMemo(() => {
    const visible = new Set(visibleKeys);
    const visibleLayers = [];
    for (const chunk of chunks) {
      if (!visible.has(chunk.key)) continue;
      let layers = geometryCache.get(chunk.key);
      if (!layers) {
        layers = createExistingBuildingGeometries(chunk.assets, worldSize);
        geometryCache.set(chunk.key, layers);
      }
      visibleLayers.push(layers);
    }
    return mergeExistingBuildingLayers(visibleLayers);
  }, [chunks, geometryCache, visibleKeys, worldSize]);
  useEffect(() => () => {
    for (const building of buildings) building.geometry.dispose();
  }, [buildings]);

  return (
    <group>
      {buildings.map(({ category, geometry }) => (
        <mesh key={category} geometry={geometry}>
          <meshStandardMaterial color={EXISTING_COLORS[category]} flatShading roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function NetworkLayer({ file, worldSize }: { file: NetworkFile; worldSize: number }) {
  const geometries = useMemo(() => createNetworkGeometries(file, worldSize), [file, worldSize]);
  useEffect(() => () => {
    geometries.roads?.dispose();
    geometries.rails?.dispose();
  }, [geometries]);

  return (
    <group>
      {geometries.roads && (
        <mesh geometry={geometries.roads} renderOrder={2}>
          <meshStandardMaterial
            color="#59636b"
            roughness={0.92}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
      {geometries.rails && (
        <mesh geometry={geometries.rails} renderOrder={2}>
          <meshStandardMaterial
            color="#4f8edc"
            roughness={0.72}
            metalness={0.08}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}
    </group>
  );
}

interface TileStyle {
  color: string;
  height: number;
  shape: "box" | "cylinder";
}

const TILE_STYLES: Record<TileType, TileStyle> = {
  res_low: { color: "#ffc94d", height: 12, shape: "box" },
  res_mid: { color: "#f7b733", height: 30, shape: "box" },
  res_high: { color: "#f2a516", height: 75, shape: "box" },
  com_shop: { color: "#ff9f43", height: 16, shape: "box" },
  com_cbd: { color: "#ee8524", height: 110, shape: "box" },
  ind_light: { color: "#a29bfe", height: 18, shape: "box" },
  ind_heavy: { color: "#8378d7", height: 25, shape: "box" },
  green_park: { color: "#2ecc9b", height: 1.2, shape: "box" },
  green_plaza: { color: "#55c9a5", height: 0.55, shape: "box" },
  edu_school: { color: "#ff6b6b", height: 18, shape: "box" },
  med_clinic: { color: "#f05d68", height: 25, shape: "box" },
  trans_metro: { color: "#54a0ff", height: 5, shape: "cylinder" },
  trans_road: { color: "#54a0ff", height: 0.35, shape: "box" },
  util_bridge: { color: "#8395a7", height: 1.4, shape: "box" },
};

const TILE_TYPES = Object.keys(TILE_STYLES) as TileType[];

interface TileInstance {
  bounds: CellBounds;
  baseY: number;
}

const EMPTY_INSTANCES: TileInstance[] = [];

function PlayerTiles({ parcel, tiles }: { parcel: Parcel; tiles: Tile[] }) {
  const groups = useMemo(() => {
    const grouped = new Map<TileType, TileInstance[]>();
    for (const tile of tiles) {
      const bounds = getCellBounds(tile.cells, parcel.size);
      if (!bounds) continue;
      let elevation = -Infinity;
      for (const anchor of tile.cells) {
        if (!cellToWorld(anchor, parcel.size, parcel.cell_size_m)) continue;
        elevation = Math.max(
          elevation,
          terrainHeight(parcel.terrain[anchor[0]]?.[anchor[1]] ?? "flat"),
        );
      }
      if (!Number.isFinite(elevation)) elevation = 0;
      const instances = grouped.get(tile.type) ?? [];
      instances.push({ bounds, baseY: elevation + 0.04 });
      grouped.set(tile.type, instances);
    }
    return grouped;
  }, [parcel, tiles]);

  return (
    <group>
      {TILE_TYPES.map((type) => (
        <PlayerTileBatch
          key={type}
          type={type}
          instances={groups.get(type) ?? EMPTY_INSTANCES}
          worldSize={parcel.size * parcel.cell_size_m}
          cellSize={parcel.cell_size_m}
        />
      ))}
    </group>
  );
}

interface PlayerTileBatchProps {
  type: TileType;
  instances: TileInstance[];
  worldSize: number;
  cellSize: number;
}

function PlayerTileBatch({ type, instances, worldSize, cellSize }: PlayerTileBatchProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const style = TILE_STYLES[type];

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const transform = new Object3D();
    const half = worldSize / 2;

    instances.forEach(({ bounds, baseY }, index) => {
      const rows = bounds.maxRow - bounds.minRow + 1;
      const columns = bounds.maxColumn - bounds.minColumn + 1;
      transform.position.set(
        ((bounds.minColumn + bounds.maxColumn + 1) / 2) * cellSize - half,
        baseY + style.height / 2,
        ((bounds.minRow + bounds.maxRow + 1) / 2) * cellSize - half,
      );
      transform.scale.set(columns * cellSize * 0.84, style.height, rows * cellSize * 0.84);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [cellSize, instances, style.height, worldSize]);

  if (instances.length === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, instances.length]}>
      {style.shape === "cylinder" ? (
        <cylinderGeometry args={[0.5, 0.5, 1, 10]} />
      ) : (
        <boxGeometry args={[1, 1, 1]} />
      )}
      <meshStandardMaterial color={style.color} flatShading roughness={0.72} />
    </instancedMesh>
  );
}

function terrainAt(parcel: Parcel, anchor: Anchor): Terrain {
  return parcel.terrain[anchor[0]]?.[anchor[1]] ?? "flat";
}

function terrainAllows(type: TileType, terrain: Terrain): boolean {
  if (type === "util_bridge") return terrain === "river" || terrain === "bank";
  if (terrain === "bank") return type === "green_park" || type === "green_plaza";
  return terrain !== "river" && terrain !== "occupied" && terrain !== "road_inherited";
}

function anchorsEqual(a: Anchor | null, b: Anchor | null): boolean {
  return a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);
}

function anchorKey(anchor: Anchor): string {
  return `${anchor[0]}:${anchor[1]}`;
}

function isPlacementValid(
  parcel: Parcel,
  type: TileType,
  cells: Anchor[],
  occupiedCells: ReadonlySet<string>,
): boolean {
  return cells.length > 0 && cells.every((anchor) => (
    cellToWorld(anchor, parcel.size, parcel.cell_size_m) !== null &&
    !occupiedCells.has(anchorKey(anchor)) &&
    terrainAllows(type, terrainAt(parcel, anchor))
  ));
}

interface PlacementGhostProps {
  parcel: Parcel;
  anchor: Anchor;
  type: TileType;
  orientation: "horizontal" | "vertical";
  valid: boolean;
}

function PlacementGhost({ parcel, anchor, type, orientation, valid }: PlacementGhostProps) {
  const cellSize = parcel.cell_size_m;
  const half = (parcel.size * cellSize) / 2;
  const style = TILE_STYLES[type];
  const cells = type === "util_bridge"
    ? bridgePlacementCells(parcel, anchor, orientation)
    : getPlacementCells(anchor, type);
  const bridgeBounds = type === "util_bridge" ? getCellBounds(cells, parcel.size) : null;
  const span = bridgeBounds
    ? {
      rows: bridgeBounds.maxRow - bridgeBounds.minRow + 1,
      columns: bridgeBounds.maxColumn - bridgeBounds.minColumn + 1,
    }
    : getTileSpan(type);
  const startRow = bridgeBounds?.minRow ?? anchor[0];
  const startColumn = bridgeBounds?.minColumn ?? anchor[1];
  let elevation = terrainHeight(terrainAt(parcel, anchor));
  for (const cell of cells) {
    if (cellToWorld(cell, parcel.size, cellSize)) {
      elevation = Math.max(elevation, terrainHeight(terrainAt(parcel, cell)));
    }
  }
  const color = valid ? "#2ecc9b" : "#ff5a65";

  return (
    <mesh
      position={[
        (startColumn + span.columns / 2) * cellSize - half,
        elevation + style.height / 2 + 0.12,
        (startRow + span.rows / 2) * cellSize - half,
      ]}
      scale={[span.columns * cellSize * 0.86, Math.max(0.5, style.height), span.rows * cellSize * 0.86]}
      renderOrder={10}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.18}
        transparent
        opacity={0.46}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

function CellCursor({ parcel, anchor, tool }: { parcel: Parcel; anchor: Anchor; tool: Tool }) {
  const center = cellToWorld(anchor, parcel.size, parcel.cell_size_m);
  if (!center) return null;
  const color = tool === "remove" ? "#ff5a65" : tool === "redevelop" ? "#ff9f43" : "#ffffff";
  return (
    <mesh
      position={[center[0], terrainHeight(terrainAt(parcel, anchor)) + 0.25, center[1]]}
      renderOrder={9}
    >
      <boxGeometry args={[parcel.cell_size_m * 0.92, 0.16, parcel.cell_size_m * 0.92]} />
      <meshBasicMaterial color={color} transparent opacity={0.42} depthWrite={false} depthTest={false} />
    </mesh>
  );
}

interface RemotePulseProps {
  parcel: Parcel;
  anchor: Anchor;
}

function RemotePulse({ parcel, anchor }: RemotePulseProps) {
  const [visible, setVisible] = useState(true);
  const meshRef = useRef<Mesh>(null);
  const materialRef = useRef<MeshBasicMaterial>(null);
  const startedAt = useRef<number | null>(null);
  const center = cellToWorld(anchor, parcel.size, parcel.cell_size_m);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 300);
    return () => window.clearTimeout(timeout);
  }, []);

  useFrame(({ clock }) => {
    if (startedAt.current === null) startedAt.current = clock.elapsedTime;
    const progress = Math.min(1, (clock.elapsedTime - startedAt.current) / 0.3);
    meshRef.current?.scale.setScalar(1 + progress * 1.1);
    if (materialRef.current) materialRef.current.opacity = 0.9 * (1 - progress);
  });

  if (!center || !visible) return null;
  return (
    <mesh
      ref={meshRef}
      position={[center[0], terrainHeight(terrainAt(parcel, anchor)) + 0.8, center[1]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={20}
    >
      <ringGeometry args={[parcel.cell_size_m * 0.28, parcel.cell_size_m * 0.4, 32]} />
      <meshBasicMaterial
        ref={materialRef}
        color="#45d7ff"
        transparent
        opacity={0.9}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** True-3D city scene. The main page may load this default export with next/dynamic(ssr:false). */
export function CityScene({
  parcel,
  tiles,
  redevelopedAssetIds,
  buildingsUrl,
  networkUrl,
  tool,
  selectedType,
  orientation = "horizontal",
  onCellAction,
  pulse = null,
}: CitySceneProps) {
  const [hovered, setHovered] = useState<Anchor | null>(null);
  const buildings = useRemoteFile<BuildingsFile>(buildingsUrl);
  const network = useRemoteFile<NetworkFile>(networkUrl);
  const worldSize = parcel.size * parcel.cell_size_m;
  const occupiedCells = useMemo(
    () => new Set(tiles.flatMap((tile) => tile.cells.map(anchorKey))),
    [tiles],
  );
  const placementCells = useMemo(() => {
    if (!hovered || tool !== "place") return [];
    return selectedType === "util_bridge"
      ? bridgePlacementCells(parcel, hovered, orientation)
      : getPlacementCells(hovered, selectedType);
  }, [hovered, orientation, parcel, selectedType, tool]);
  const placementValid = hovered !== null && isPlacementValid(
    parcel,
    selectedType,
    placementCells,
    occupiedCells,
  );

  const hover = (point: WorldPoint) => {
    const next = worldToCell(point[0], point[1], parcel.size, parcel.cell_size_m);
    setHovered((previous) => anchorsEqual(previous, next) ? previous : next);
  };
  const select = (point: WorldPoint, dragDistance: number) => {
    if (dragDistance > 5) return;
    const anchor = worldToCell(point[0], point[1], parcel.size, parcel.cell_size_m);
    if (!anchor) return;
    if (tool === "place") {
      const cells = selectedType === "util_bridge"
        ? bridgePlacementCells(parcel, anchor, orientation)
        : getPlacementCells(anchor, selectedType);
      if (!isPlacementValid(parcel, selectedType, cells, occupiedCells)) return;
    }
    onCellAction(anchor);
  };

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 360, overflow: "hidden" }}
      aria-label="城市三维沙盘"
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{
          position: [worldSize * 0.68, worldSize * 0.82, worldSize * 0.9],
          fov: 45,
          near: Math.max(0.1, parcel.cell_size_m / 20),
          far: worldSize * 6,
        }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onPointerMissed={() => setHovered(null)}
        fallback={<div style={{ padding: 24 }}>当前设备无法初始化 WebGL 3D 场景。</div>}
      >
        <color attach="background" args={["#dce9ed"]} />
        <fog attach="fog" args={["#dce9ed", worldSize * 1.5, worldSize * 3.5]} />
        <hemisphereLight args={["#f2f7ff", "#64745b", 1.8]} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[worldSize * 0.4, worldSize * 0.85, worldSize * 0.25]}
          intensity={2.2}
        />

        <mesh position={[0, -4.55, 0]}>
          <boxGeometry args={[worldSize + parcel.cell_size_m, 1, worldSize + parcel.cell_size_m]} />
          <meshStandardMaterial color="#87988b" roughness={1} />
        </mesh>
        <TerrainLayer parcel={parcel} onHover={hover} onLeave={() => setHovered(null)} onSelect={select} />
        {buildings.data && (
          <ExistingBuildings
            file={buildings.data}
            redevelopedAssetIds={redevelopedAssetIds}
            worldSize={worldSize}
            cellSize={parcel.cell_size_m}
          />
        )}
        {network.data && <NetworkLayer file={network.data} worldSize={worldSize} />}
        <PlayerTiles parcel={parcel} tiles={tiles} />

        {hovered && tool === "place" && (
          <PlacementGhost
            parcel={parcel}
            anchor={hovered}
            type={selectedType}
            orientation={orientation}
            valid={placementValid}
          />
        )}
        {hovered && tool !== "place" && <CellCursor parcel={parcel} anchor={hovered} tool={tool} />}
        {pulse && (
          <RemotePulse
            key={`${pulse.seq}:${pulse.anchor[0]}:${pulse.anchor[1]}`}
            parcel={parcel}
            anchor={pulse.anchor}
          />
        )}

        <OrbitControls
          makeDefault
          target={[0, 0, 0]}
          enableDamping
          dampingFactor={0.12}
          minDistance={parcel.cell_size_m * 3}
          maxDistance={worldSize * 2.2}
          maxPolarAngle={Math.PI / 2.12}
          screenSpacePanning={false}
        />
      </Canvas>

      <div
        aria-live="polite"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          pointerEvents: "none",
          fontSize: 12,
        }}
      >
        {(buildings.loading || network.loading) && (
          <span role="status" style={{ background: "#ffffffdd", padding: "5px 8px", borderRadius: 4 }}>
            正在加载建筑与路网…
          </span>
        )}
        {buildings.error && (
          <span role="alert" style={{ background: "#fff0f0ee", color: "#a52828", padding: "5px 8px", borderRadius: 4 }}>
            建筑数据加载失败：{buildings.error}
          </span>
        )}
        {network.error && (
          <span role="alert" style={{ background: "#fff0f0ee", color: "#a52828", padding: "5px 8px", borderRadius: 4 }}>
            路网数据加载失败：{network.error}
          </span>
        )}
      </div>
    </div>
  );
}

export default CityScene;
