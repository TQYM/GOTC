"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  landmarkOf,
  TOON_BUILDING_COLORS,
  TOON_LANDMARK_COLORS,
  type LandmarkKey,
} from "@saves/lib/cityModel";
import {
  createExistingAssetChunks,
  createExistingBuildingGeometries,
  createLandmarkLabelLayouts,
  createNetworkGeometries,
  flattenActiveAssets,
  getVisibleChunkKeys,
  mergeExistingBuildingLayers,
  type SceneLabel,
} from "@saves/lib/scene";
import type { BuildingsFile, NetworkFile } from "@saves/lib/types";
import { toonMaterial } from "./toon";

/** 卡通材质（PR-36）：与全域地图同一套 3 阶 toon 与粉彩灰白配色，地标（中国尊金 / 央视橙）单独着色 */
const EXISTING_MATERIALS = {
  residential: toonMaterial({ color: TOON_BUILDING_COLORS.residential }),
  workplace: toonMaterial({ color: TOON_BUILDING_COLORS.workplace }),
  industrial: toonMaterial({ color: TOON_BUILDING_COLORS.industrial }),
  civic: toonMaterial({ color: TOON_BUILDING_COLORS.civic }),
} as const;
const LANDMARK_MATERIALS = Object.fromEntries(
  Object.entries(TOON_LANDMARK_COLORS).map(([k, color]) => [
    k,
    toonMaterial({ color }),
  ]),
) as Record<LandmarkKey, ReturnType<typeof toonMaterial>>;
const ROAD_MATERIAL = toonMaterial({
  color: "#f3efe6",
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
const RAIL_MATERIAL = toonMaterial({
  color: "#7fb2e6",
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

/** 沙盘里的地标（中国尊 / 央视等）：从分块合并里剔除，单独按地标色绘制 */
function LandmarkAssets({
  file,
  redevelopedAssetIds,
  worldSize,
}: {
  file: BuildingsFile;
  redevelopedAssetIds: string[];
  worldSize: number;
}) {
  const items = useMemo(
    () =>
      flattenActiveAssets(file, redevelopedAssetIds).flatMap((asset) => {
        const key = landmarkOf(null, asset.name ?? null);
        if (!key) return [];
        return createExistingBuildingGeometries([asset], worldSize).map(
          (g) => ({
            key: `${asset.asset_id}-${g.category}`,
            landmark: key,
            geometry: g.geometry,
          }),
        );
      }),
    [file, redevelopedAssetIds, worldSize],
  );
  useEffect(
    () => () => {
      for (const item of items) item.geometry.dispose();
    },
    [items],
  );
  return (
    <group name="existing-landmarks">
      {items.map((item) => (
        <mesh
          key={item.key}
          geometry={item.geometry}
          material={LANDMARK_MATERIALS[item.landmark]}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

function landmarkIds(file: BuildingsFile): string[] {
  return flattenActiveAssets(file, [])
    .filter((a) => landmarkOf(null, a.name ?? null))
    .map((a) => a.asset_id);
}

interface RemoteFile<T> {
  url: string | null;
  data: T | null;
  error: boolean;
}

function useRemoteFile<T>(url: string | null): RemoteFile<T> {
  const [state, setState] = useState<RemoteFile<T>>({
    url: null,
    data: null,
    error: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    if (!url) return () => controller.abort();
    void fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<T>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setState({ url, data, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({ url, data: null, error: true });
      });
    return () => controller.abort();
  }, [url]);
  return state.url === url ? state : { url, data: null, error: false };
}

function ExistingBuildings({
  file,
  redevelopedAssetIds,
  worldSize,
  cellSize,
}: {
  file: BuildingsFile;
  redevelopedAssetIds: string[];
  worldSize: number;
  cellSize: number;
}) {
  const chunks = useMemo(
    () =>
      createExistingAssetChunks(
        file,
        [...redevelopedAssetIds, ...landmarkIds(file)],
        worldSize,
      ),
    [file, redevelopedAssetIds, worldSize],
  );
  const [buildings, setBuildings] = useState<
    ReturnType<typeof createExistingBuildingGeometries>
  >([]);
  const buildingsRef = useRef<
    ReturnType<typeof createExistingBuildingGeometries>
  >([]);
  const geometryCache = useRef(
    new Map<string, ReturnType<typeof createExistingBuildingGeometries>>(),
  );
  const lastCheck = useRef(-Infinity);
  const lastChunks = useRef<typeof chunks | null>(null);
  const lastWorldSize = useRef(worldSize);
  const lastVisibleSignature = useRef<string | null>(null);
  const neighborMargin = cellSize * 8;

  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - lastCheck.current < 0.12) return;
    lastCheck.current = clock.elapsedTime;
    if (lastChunks.current !== chunks || lastWorldSize.current !== worldSize) {
      for (const cached of geometryCache.current.values()) {
        for (const layer of cached) layer.geometry.dispose();
      }
      geometryCache.current.clear();
      lastChunks.current = chunks;
      lastWorldSize.current = worldSize;
      lastVisibleSignature.current = null;
    }
    const next = getVisibleChunkKeys(chunks, camera, neighborMargin);
    const signature = next.join("|");
    if (signature === lastVisibleSignature.current) return;
    lastVisibleSignature.current = signature;
    const visible = new Set(next);
    const layers = [];
    for (const chunk of chunks) {
      if (!visible.has(chunk.key)) continue;
      let cached = geometryCache.current.get(chunk.key);
      if (!cached) {
        cached = createExistingBuildingGeometries(chunk.assets, worldSize);
        geometryCache.current.set(chunk.key, cached);
      }
      layers.push(cached);
    }
    const merged = mergeExistingBuildingLayers(layers);
    for (const previous of buildingsRef.current) previous.geometry.dispose();
    buildingsRef.current = merged;
    setBuildings(merged);
  });

  useEffect(
    () => () => {
      for (const cached of geometryCache.current.values()) {
        for (const layer of cached) layer.geometry.dispose();
      }
      geometryCache.current.clear();
      for (const building of buildingsRef.current) building.geometry.dispose();
    },
    [],
  );

  return (
    <group name="existing-buildings">
      {buildings.map(({ category, geometry }) => (
        <mesh
          key={category}
          geometry={geometry}
          material={EXISTING_MATERIALS[category]}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

function NetworkLayer({
  file,
  worldSize,
}: {
  file: NetworkFile;
  worldSize: number;
}) {
  const geometries = useMemo(
    () => createNetworkGeometries(file, worldSize),
    [file, worldSize],
  );
  useEffect(
    () => () => {
      geometries.roads?.dispose();
      geometries.rails?.dispose();
    },
    [geometries],
  );
  return (
    <group name="existing-network">
      {geometries.roads && (
        <mesh
          geometry={geometries.roads}
          renderOrder={2}
          material={ROAD_MATERIAL}
        />
      )}
      {geometries.rails && (
        <mesh
          geometry={geometries.rails}
          renderOrder={3}
          material={RAIL_MATERIAL}
        />
      )}
    </group>
  );
}

interface LabelFile {
  labels: SceneLabel[];
}

function LandmarkLabels({
  file,
  buildings,
  worldSize,
}: {
  file: LabelFile;
  buildings: BuildingsFile;
  worldSize: number;
}) {
  const sprites = useMemo(() => {
    return createLandmarkLabelLayouts(file, buildings, worldSize).map(
      ({ label, position }, index) => {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 128;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "rgba(20, 35, 40, .82)";
        context.roundRect(4, 12, 504, 104, 28);
        context.fill();
        context.fillStyle = "#fff8dc";
        context.font = "600 48px sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label.name, 256, 64, 470);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
        });
        return {
          key: `${label.name}-${index}`,
          material,
          position,
        };
      },
    );
  }, [file, buildings, worldSize]);
  useEffect(
    () => () => {
      for (const sprite of sprites) {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
    },
    [sprites],
  );
  return (
    <group name="landmark-labels">
      {sprites.map((sprite) => (
        <sprite
          key={sprite.key}
          position={sprite.position}
          scale={[100, 25, 1]}
          material={sprite.material}
          renderOrder={20}
        />
      ))}
    </group>
  );
}

export default function RealCityLayers({
  buildingsUrl,
  networkUrl,
  redevelopedAssetIds,
  worldSize,
  cellSize,
}: {
  buildingsUrl?: string | null;
  networkUrl?: string | null;
  redevelopedAssetIds: string[];
  worldSize: number;
  cellSize: number;
}) {
  const buildings = useRemoteFile<BuildingsFile>(buildingsUrl ?? null);
  const network = useRemoteFile<NetworkFile>(networkUrl ?? null);
  const labelsUrl = buildingsUrl?.endsWith("/buildings.json")
    ? buildingsUrl.replace(/buildings\.json$/, "labels.json")
    : null;
  const labels = useRemoteFile<LabelFile>(labelsUrl);
  return (
    <group name="real-city">
      {buildings.data && (
        <LandmarkAssets
          file={buildings.data}
          redevelopedAssetIds={redevelopedAssetIds}
          worldSize={worldSize}
        />
      )}
      {buildings.data && (
        <ExistingBuildings
          file={buildings.data}
          redevelopedAssetIds={redevelopedAssetIds}
          worldSize={worldSize}
          cellSize={cellSize}
        />
      )}
      {network.data && (
        <NetworkLayer file={network.data} worldSize={worldSize} />
      )}
      {labels.data && buildings.data && (
        <LandmarkLabels
          file={labels.data}
          buildings={buildings.data}
          worldSize={worldSize}
        />
      )}
      {(buildings.error || network.error) && (
        <group name="real-city-load-error" />
      )}
    </group>
  );
}
