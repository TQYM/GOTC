"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  createExistingAssetChunks,
  createExistingBuildingGeometries,
  createLandmarkLabelLayouts,
  createNetworkGeometries,
  getVisibleChunkKeys,
  mergeExistingBuildingLayers,
  type SceneLabel,
} from "@saves/lib/scene";
import type { BuildingsFile, NetworkFile } from "@saves/lib/types";

const EXISTING_COLORS = {
  residential: "#e8e6e1",
  workplace: "#d5d2cc",
  industrial: "#c4c0ba",
  civic: "#ddd9d1",
} as const;

interface RemoteFile<T> {
  url: string | null;
  data: T | null;
  error: boolean;
}

function useRemoteFile<T>(url: string | null): RemoteFile<T> {
  const [state, setState] = useState<RemoteFile<T>>({ url: null, data: null, error: false });
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
        if (!controller.signal.aborted) setState({ url, data: null, error: true });
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
    () => createExistingAssetChunks(file, redevelopedAssetIds, worldSize),
    [file, redevelopedAssetIds, worldSize],
  );
  const [buildings, setBuildings] = useState<ReturnType<typeof createExistingBuildingGeometries>>([]);
  const buildingsRef = useRef<ReturnType<typeof createExistingBuildingGeometries>>([]);
  const geometryCache = useRef(new Map<string, ReturnType<typeof createExistingBuildingGeometries>>());
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

  useEffect(() => () => {
    for (const cached of geometryCache.current.values()) {
      for (const layer of cached) layer.geometry.dispose();
    }
    geometryCache.current.clear();
    for (const building of buildingsRef.current) building.geometry.dispose();
  }, []);

  return (
    <group name="existing-buildings">
      {buildings.map(({ category, geometry }) => (
        <mesh key={category} geometry={geometry} castShadow receiveShadow>
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
    <group name="existing-network">
      {geometries.roads && (
        <mesh geometry={geometries.roads} renderOrder={2}>
          <meshStandardMaterial color="#59636b" roughness={0.92} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
        </mesh>
      )}
      {geometries.rails && (
        <mesh geometry={geometries.rails} renderOrder={3}>
          <meshStandardMaterial color="#4f8edc" roughness={0.6} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
        </mesh>
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
    return createLandmarkLabelLayouts(file, buildings, worldSize).map(({ label, position }, index) => {
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
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      return {
        key: `${label.name}-${index}`,
        material,
        position,
      };
    });
  }, [file, buildings, worldSize]);
  useEffect(() => () => {
    for (const sprite of sprites) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
  }, [sprites]);
  return (
    <group name="landmark-labels">
      {sprites.map((sprite) => (
        <sprite key={sprite.key} position={sprite.position} scale={[100, 25, 1]} material={sprite.material} renderOrder={20} />
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
        <ExistingBuildings
          file={buildings.data}
          redevelopedAssetIds={redevelopedAssetIds}
          worldSize={worldSize}
          cellSize={cellSize}
        />
      )}
      {network.data && <NetworkLayer file={network.data} worldSize={worldSize} />}
      {labels.data && buildings.data && (
        <LandmarkLabels file={labels.data} buildings={buildings.data} worldSize={worldSize} />
      )}
      {(buildings.error || network.error) && <group name="real-city-load-error" />}
    </group>
  );
}
