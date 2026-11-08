"use client";

/**
 * CityScene3D（05 §2.3 / 11 §6 / PR-36）：卡通风格真 3D 场景。
 *
 * - 传入 `map`（北京全域数据包）时：渲染 154×189km 全域地形 / 建筑 / 道路 / 水系 / 地名（各层 1 个 draw call，
 *   48×48 格分块视锥裁剪），可玩沙盘（48×48 @50m）作为一块「沙盘」嵌在朝阳 CBD 片区；
 *   相机 500m–200km 对数缩放、预设导航与双击飞抵。
 * - 不传 `map` 时：仅渲染可玩沙盘（PR-04 行为）。
 * - 天际线式操控（CameraRig：右键旋转、中键 / WASD 平移、滚轮向光标缩放、Home 复位）；
 * - 1 方向光 + 半球环境光，关闭色调映射（flat）保留卡通高饱和配色；全域模式关闭阴影；
 * - 只渲染契约数据（parcel + tiles[].cells），放置 / 拆除接口不变，坐标换算统一走 coords.ts。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Cell, Parcel, Tile } from "@/lib/contract";
import type { FullMapData } from "@/lib/map/types";
import { presetShot, type CameraShot, type PresetKey } from "@/lib/map/presets";
import { SCENE_COLORS } from "@/lib/palette";
import CameraRig from "./CameraRig";
import RealCityLayers from "./RealCityLayers";
import {
  boardAnchorOnMap,
  cellToWorld,
  gridOf,
  mapFrame,
  mapToWorld,
  Surface,
  TERRAIN_HEIGHT,
} from "./coords";
import {
  CellFrames,
  ForestLayer,
  GhostLayer,
  HoverFrame,
  OccupiedLayer,
  TerrainLayer,
  TileLayer,
  type GhostSpec,
} from "./layers";
import MapLayers from "./map/MapLayers";
import MapLabels from "./map/MapLabels";
import MapPicker, { type MapPick } from "./map/MapPicker";
import BuildingPanel from "./map/BuildingPanel";
import SelectionBox from "./map/SelectionBox";

export type { GhostSpec } from "./layers";
export type { PresetKey } from "@/lib/map/presets";

export interface SceneStats {
  fps: number;
  drawCalls: number;
  triangles: number;
}

export interface CityScene3DProps {
  parcel: Parcel;
  tiles: Tile[];
  /** saves v2 的真实资产与更新改造过滤。 */
  redevelopedAssetIds?: string[];
  buildingsUrl?: string | null;
  networkUrl?: string | null;
  /** 放置预览（PR-05 拖拽时传入）：半透明 ghost + 覆盖格红绿框 */
  ghost?: GhostSpec | null;
  onCellHover?: (cell: Cell | null) => void;
  onCellClick?: (cell: Cell) => void;
  /** 每 0.5s 回报一次帧率与 draw call，用于性能记录 */
  onStats?: (s: SceneStats) => void;
  /** 强制开关阴影；缺省按设备（触屏关）；全域模式恒关 */
  shadows?: boolean;
  /** 额外格框高亮（拆除模式选中的区块等） */
  overlay?: { cells: Cell[]; color: string } | null;
  /** 右键单击（无拖拽）：退出当前工具（13 §4.1） */
  onRightClick?: () => void;
  /** 画布光标样式（放置 / 拆除模式换光标） */
  cursor?: string;
  /** 值变化时相机回到默认鸟瞰 */
  resetViewSignal?: number;
  /** 北京全域数据（PR-36）；null 时只渲染沙盘 */
  map?: FullMapData | null;
  /** 地图就绪后的初始机位 */
  initialPreset?: PresetKey;
  /** 预设导航请求（token 变化触发 1.2s 平滑飞行） */
  presetRequest?: { key: PresetKey; token: number } | null;
  /** 顶部留给 HUD 的像素带（不在其中放地名标签） */
  labelTopInset?: number;
  /** 是否允许单击全域地图上的建筑弹出信息面板（放置 / 拆除模式下关闭） */
  mapPickEnabled?: boolean;
  /** 暴露 window.__city20Scene 供 E2E 拾取校验 */
  debugHook?: boolean;
  className?: string;
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}

/** `?perf=1`：画布右下角显示 fps / draw call / 三角形数（真机测性能用，不影响正常游戏） */
function usePerfFlag() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(
      () => setOn(/[?&]perf=1/.test(window.location.search)),
      0,
    );
    return () => clearTimeout(t);
  }, []);
  return on;
}

function StatsProbe({ onStats }: { onStats: (s: SceneStats) => void }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, since: 0 });
  useFrame(() => {
    const a = acc.current;
    const now = performance.now();
    if (a.since === 0) a.since = now;
    a.frames++;
    if (now - a.since >= 500) {
      onStats({
        fps: Math.round((a.frames * 1000) / (now - a.since)),
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      });
      a.frames = 0;
      a.since = now;
    }
  });
  return null;
}

/** 全域模式下调整相机近 / 远裁剪面与雾 */
function CameraEnvelope({ near, far }: { near: number; far: number }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const cam = get().camera as THREE.PerspectiveCamera;
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
  }, [get, near, far]);
  return null;
}

/** E2E 钩子：把格中心投影到 canvas 像素坐标，用于校验拾取零偏移（含沙盘在全域上的偏移） */
function DebugHook({
  parcel,
  offset,
}: {
  parcel: Parcel;
  offset: [number, number, number];
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const g = gridOf(parcel);
    const api = {
      cellToScreen(r: number, c: number): [number, number] {
        const [x, z] = cellToWorld(g, r, c);
        const t = parcel.terrain[r][c];
        const v = new THREE.Vector3(
          x + offset[0],
          TERRAIN_HEIGHT[t] + offset[1],
          z + offset[2],
        ).project(camera);
        return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
      },
      cameraHeight: () => camera.position.y,
    };
    (window as unknown as { __city20Scene?: typeof api }).__city20Scene = api;
    return () => {
      delete (window as unknown as { __city20Scene?: typeof api })
        .__city20Scene;
    };
  }, [camera, size, parcel, offset]);
  return null;
}

/** E2E 钩子（?debug=1）：按类别 / 名称找全域建筑并投影到 canvas 像素坐标，用于校验按格拾取与面板 */
function MapDebugHook({
  map,
  surface,
}: {
  map: FullMapData;
  surface: Surface;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const t = map.table;
    const api = {
      find(query: {
        name?: string;
        category?: number;
        near?: [number, number];
      }) {
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < t.count; i++) {
          if (query.name !== undefined && t.names[i] !== query.name) continue;
          if (query.category !== undefined && t.category[i] !== query.category)
            continue;
          const d = query.near
            ? Math.hypot(t.cx[i] - query.near[0], t.cy[i] - query.near[1])
            : 0;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        return best;
      },
      toScreen(i: number): [number, number] {
        const x = (t.bbox[i * 4] + t.bbox[i * 4 + 2]) / 2;
        const y = (t.bbox[i * 4 + 1] + t.bbox[i * 4 + 3]) / 2;
        const [wx, wz] = mapToWorld(surface.f, x, y);
        const v = new THREE.Vector3(
          wx,
          surface.heightAt(x, y) + t.height[i],
          wz,
        ).project(camera);
        return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
      },
      landmarks: map.landmarks,
      stats: map.stats,
    };
    (window as unknown as { __city20Map?: typeof api }).__city20Map = api;
    return () => {
      delete (window as unknown as { __city20Map?: typeof api }).__city20Map;
    };
  }, [map, surface, camera, size]);
  return null;
}

export default function CityScene3D({
  parcel,
  tiles,
  redevelopedAssetIds = [],
  buildingsUrl = parcel.buildings_url,
  networkUrl = parcel.network_url,
  ghost = null,
  onCellHover,
  onCellClick,
  onStats,
  shadows,
  resetViewSignal = 0,
  overlay = null,
  onRightClick,
  cursor,
  map = null,
  initialPreset = "all",
  presetRequest = null,
  labelTopInset = 0,
  mapPickEnabled = true,
  debugHook = false,
  className,
}: CityScene3DProps) {
  const rightDown = useRef<[number, number] | null>(null);
  const coarse = useCoarsePointer();
  const perf = usePerfFlag();
  const [perfStats, setPerfStats] = useState<SceneStats | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const hoverRef = useRef<Cell | null>(null);
  const [labelLayer, setLabelLayer] = useState<HTMLDivElement | null>(null);
  const [pick, setPick] = useState<{ map: FullMapData; pick: MapPick } | null>(
    null,
  );
  // 选中只对当前这份地图数据有效（地图重载后自动失效）
  const picked = pick && pick.map === map && mapPickEnabled ? pick.pick : null;
  const onMapPick = useCallback(
    (p: MapPick | null) => setPick(p && map ? { map, pick: p } : null),
    [map],
  );
  const boardExtent = parcel.size * parcel.cell_size_m;

  // 全域几何：地表采样器、沙盘锚点（CBD 片区）与世界偏移
  const world = useMemo(() => {
    if (!map) return null;
    const frame = mapFrame(map.grid);
    const surface = new Surface(frame, map.elevation);
    const a = boardAnchorOnMap(map.bbox, parcel);
    const [wx, wz] = mapToWorld(frame, a.x, a.y);
    const offset: [number, number, number] = [
      wx,
      surface.heightAt(a.x, a.y) + 1.5,
      wz,
    ];
    return { frame, surface, offset };
  }, [map, parcel]);

  const shadowOn = world ? false : (shadows ?? !coarse);
  const extent = world
    ? Math.max(world.frame.width, world.frame.height)
    : boardExtent;
  const boardOffset = useMemo<[number, number, number]>(
    () => world?.offset ?? [0, 0, 0],
    [world],
  );

  const handleHover = useCallback(
    (cell: Cell | null) => {
      const prev = hoverRef.current;
      if (
        prev === cell ||
        (prev && cell && prev[0] === cell[0] && prev[1] === cell[1])
      )
        return;
      hoverRef.current = cell;
      setHover(cell);
      onCellHover?.(cell);
    },
    [onCellHover],
  );
  const handlePick = useCallback(
    (cell: Cell) => onCellClick?.(cell),
    [onCellClick],
  );

  const camPos = useMemo<[number, number, number]>(
    () => [boardExtent * 0.92, boardExtent * 1.2, boardExtent * 1.4],
    [boardExtent],
  );
  const home = useMemo<[number, number, number]>(
    () => (world && map ? presetShot("all", map, world.surface).pos : camPos),
    [world, map, camPos],
  );

  // 飞行请求：地图就绪 → 瞬移到初始机位；预设按钮 / 双击 → 1.2s 平滑飞行
  const [fly, setFly] = useState<{
    pos: [number, number, number];
    target: [number, number, number];
    token: number;
    duration: number;
  } | null>(null);
  const flyTo = useCallback(
    (shot: CameraShot, duration: number) =>
      setFly((f) => ({ ...shot, token: (f?.token ?? 0) + 1, duration })),
    [],
  );
  useEffect(() => {
    if (!world || !map) return;
    const t = setTimeout(
      () => flyTo(presetShot(initialPreset, map, world.surface), 0),
      0,
    );
    return () => clearTimeout(t);
  }, [world, map, initialPreset, flyTo]);
  useEffect(() => {
    if (!presetRequest || !world || !map) return;
    const t = setTimeout(
      () => flyTo(presetShot(presetRequest.key, map, world.surface), 1200),
      0,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetRequest?.token]);
  const onDoubleFly = useCallback(
    (shot: CameraShot) => flyTo(shot, 1200),
    [flyTo],
  );

  const shadowCam = boardExtent * 0.62;
  const bg = world ? "#e8f1f6" : SCENE_COLORS.background;

  return (
    <div
      className={`relative h-full w-full min-h-0 min-w-0 ${className ?? ""}`}
      data-testid="city-scene"
      data-map={world ? "full" : "board"}
      style={cursor ? { cursor } : undefined}
      onPointerDown={(e) => {
        if (e.button === 2) rightDown.current = [e.clientX, e.clientY];
      }}
      onPointerUp={(e) => {
        const d = rightDown.current;
        rightDown.current = null;
        // 右键拖拽是旋转视角；只有几乎不动的右键单击才算「退出工具」
        if (
          e.button === 2 &&
          d &&
          Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 5
        )
          onRightClick?.();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        shadows={shadowOn ? "percentage" : false}
        dpr={[1, coarse ? 1.5 : 2]}
        camera={{ position: camPos, fov: 35, near: 5, far: boardExtent * 8 }}
        flat
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          logarithmicDepthBuffer: true,
        }}
        onPointerMissed={() => handleHover(null)}
      >
        <color attach="background" args={[bg]} />
        {world ? (
          <fog attach="fog" args={[bg, 160000, 450000]} />
        ) : (
          <fog attach="fog" args={[bg, boardExtent * 2.2, boardExtent * 5]} />
        )}
        <CameraEnvelope
          near={world ? 5 : 5}
          far={world ? 600000 : boardExtent * 8}
        />
        <hemisphereLight
          args={["#ffffff", world ? "#b8c4cc" : "#c9d6b8", world ? 1.05 : 1.15]}
        />
        <directionalLight
          position={
            world
              ? [60000, 120000, 40000]
              : [boardExtent * 0.45, boardExtent * 0.9, boardExtent * 0.3]
          }
          intensity={world ? 1.6 : 1.7}
          castShadow={shadowOn}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-shadowCam}
          shadow-camera-right={shadowCam}
          shadow-camera-top={shadowCam}
          shadow-camera-bottom={-shadowCam}
          shadow-camera-near={10}
          shadow-camera-far={boardExtent * 3}
          shadow-bias={-0.0004}
          shadow-normalBias={1.5}
        />

        {map && (
          <MapLayers
            data={map}
            hideBoardLandmarks={!!(buildingsUrl || networkUrl)}
          />
        )}
        {map && (
          <MapLabels
            labels={map.labels}
            layer={labelLayer}
            topInset={labelTopInset}
          />
        )}
        {world && map && (
          <MapPicker
            data={map}
            surface={world.surface}
            onFly={onDoubleFly}
            onPick={mapPickEnabled ? onMapPick : undefined}
          />
        )}
        {world && map && picked && picked.building >= 0 && (
          <SelectionBox
            table={map.table}
            index={picked.building}
            surface={world.surface}
          />
        )}

        {/* 可玩沙盘：全域模式下平移到 CBD 片区，拾取在沙盘局部坐标内完成 */}
        <group position={boardOffset}>
          <TerrainLayer
            parcel={parcel}
            onHover={handleHover}
            onPick={handlePick}
          />
          <ForestLayer parcel={parcel} tiles={tiles} />
          {buildingsUrl || networkUrl ? (
            <RealCityLayers
              buildingsUrl={buildingsUrl}
              networkUrl={networkUrl}
              redevelopedAssetIds={redevelopedAssetIds}
              worldSize={boardExtent}
              cellSize={parcel.cell_size_m}
            />
          ) : (
            <OccupiedLayer parcel={parcel} />
          )}
          <TileLayer parcel={parcel} tiles={tiles} />
          <HoverFrame parcel={parcel} cell={ghost || overlay ? null : hover} />
          <GhostLayer parcel={parcel} ghost={ghost} />
          {overlay && (
            <CellFrames
              parcel={parcel}
              cells={overlay.cells}
              color={overlay.color}
            />
          )}
        </group>

        <CameraRig
          extent={extent}
          home={home}
          resetSignal={resetViewSignal}
          distanceRange={world ? [400, 260000] : undefined}
          bounds={
            world ? [world.frame.width / 2, world.frame.height / 2] : undefined
          }
          fly={fly}
        />
        {onStats && <StatsProbe onStats={onStats} />}
        {perf && <StatsProbe onStats={setPerfStats} />}
        {debugHook && <DebugHook parcel={parcel} offset={boardOffset} />}
        {debugHook && map && world && (
          <MapDebugHook map={map} surface={world.surface} />
        )}
      </Canvas>
      {/* 地名标签 DOM 层（billboard，始终面向相机、不受雾影响） */}
      <div
        ref={setLabelLayer}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        data-testid="map-labels"
        aria-hidden
      />
      {perf && perfStats && (
        <div
          className="pointer-events-none absolute bottom-3 right-3 z-10 rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-white"
          data-testid="perf-hud"
          data-fps={perfStats.fps}
          data-calls={perfStats.drawCalls}
          data-tris={perfStats.triangles}
        >
          {perfStats.fps} fps · {perfStats.drawCalls} calls ·{" "}
          {(perfStats.triangles / 1e6).toFixed(2)}M tris
        </div>
      )}
      {map && picked && (
        <div className="pointer-events-none absolute bottom-28 left-3 z-10 sm:bottom-auto sm:top-16">
          <BuildingPanel
            table={map.table}
            index={picked.building}
            cell={picked.cell}
            onClose={() => setPick(null)}
          />
        </div>
      )}
    </div>
  );
}
