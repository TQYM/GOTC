"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  landmarkOf,
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
import { withBase } from "@/lib/api/base";
import { EXISTING_FACES, PX, SCENE_COLORS } from "@/lib/palette";
import { toonMaterial } from "./toon";

const LANDMARK_MATERIALS = Object.fromEntries(
  Object.entries(TOON_LANDMARK_COLORS).map(([k, color]) => [k, toonMaterial({ color })]),
) as unknown as Record<LandmarkKey, THREE.Material>;

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

/** 地名标签单独放在第 1 层：像素化渲染时以全分辨率叠加，保证可读（16 §5.2） */
export const LABEL_LAYER = 1;

const PIXEL_FONT = '"Pixelify Sans", "ZCOOL QingKe HuangYou", sans-serif';

/**
 * 既有建筑按面法线写顶点色（16 §3.4 / §5.1）：朝上的面写屋顶色，其余写墙色；
 * 在 chunk 几何创建时做一次，随 chunk 缓存，合批后仍保留。
 */
// 原型：街区主题屋顶（同一街区共用一种屋顶色），让 2 万栋奶油色楼读出城市肌理
const DISTRICT_ROOFS = ["#FF9E6B", "#7CCBFF", "#FFC93C", "#C4B2FF", "#8EF0BF", "#FF9AAE"].map((c) => new THREE.Color(c));

function paintFaces(geometry: THREE.BufferGeometry, category: keyof typeof EXISTING_FACES, block: number) {
  const faces = EXISTING_FACES[category];
  const wall = new THREE.Color(faces.m);
  const roof = new THREE.Color(faces.t);
  const themed = category === "civic" || category === "residential";
  const normal = geometry.getAttribute("normal");
  const position = geometry.getAttribute("position");
  const n = position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const up = normal && normal.getY(i) > 0.5;
    let c = up ? roof : wall;
    if (up && themed) {
      const bx = Math.floor(position.getX(i) / block);
      const bz = Math.floor(position.getZ(i) / block);
      const h = Math.abs(Math.imul(bx * 73856093 ^ bz * 19349663, 2654435761)) >>> 0;
      c = DISTRICT_ROOFS[h % DISTRICT_ROOFS.length];
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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
    // 后端返回的是 /static/... 这种相对路径；静态包（APK / 本地 HTML）里后端不在同源，必须拼 API_BASE
    void fetch(withBase(url), { signal: controller.signal })
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
    // 48km 全城棋盘不做视锥裁剪：玩家要的是「一眼看到全北京」，
    // 只加载视野内的 chunk 会让地图看起来「只有一部分区块」。
    // 2.4km 精细片区仍按视锥裁剪，省显存。
    const next =
      worldSize > 10000
        ? chunks.map((chunk) => chunk.key)
        : getVisibleChunkKeys(chunks, camera, neighborMargin);
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
        for (const layer of cached) paintFaces(layer.geometry, layer.category, worldSize / 24);
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

  const material = useMemo(() => toonMaterial({ vertexColors: true }), []);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <group name="existing-buildings">
      {buildings.map(({ category, geometry }) => (
        <mesh key={category} geometry={geometry} material={material} castShadow receiveShadow />
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
        <mesh geometry={geometries.roads} renderOrder={2} receiveShadow>
          <meshToonMaterial
            color={SCENE_COLORS.asphalt}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
      {geometries.rails && (
        <mesh geometry={geometries.rails} renderOrder={3} receiveShadow>
          <meshToonMaterial
            color={SCENE_COLORS.rail}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
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
  // 像素字体异步加载：加载完成后重绘一次标签
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    let alive = true;
    void document.fonts?.load(`32px ${PIXEL_FONT}`, "国贸").then(() => {
      if (alive) setFontsReady((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  const sprites = useMemo(() => {
    return createLandmarkLabelLayouts(file, buildings, worldSize).map(({ label, position }, index) => {
      // 像素牌：纸色底 + 墨色描边 + 下方小三角（16 §5.1 第 7 条），最近邻采样保持硬边
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 72;
      const context = canvas.getContext("2d")!;
      context.imageSmoothingEnabled = false;
      context.fillStyle = PX.ink;
      context.fillRect(8, 4, 240, 52);
      context.fillRect(116, 56, 24, 6);
      context.fillRect(122, 62, 12, 6);
      context.fillStyle = PX.paper;
      context.fillRect(14, 10, 228, 40);
      context.fillStyle = PX.ink;
      context.font = `32px ${PIXEL_FONT}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label.name, 128, 31, 216);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      return {
        key: `${label.name}-${index}-${fontsReady}`,
        material,
        position,
      };
    });
  }, [file, buildings, worldSize, fontsReady]);
  useEffect(() => () => {
    for (const sprite of sprites) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
  }, [sprites]);
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
