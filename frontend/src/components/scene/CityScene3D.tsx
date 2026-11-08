"use client";

/**
 * CityScene3D（05 §2.3 / 11 §6 / PR-36 / 16 §5）：真 3D 卡通沙盘，可选像素化后处理。
 *
 * - 传入 `map`（北京全域数据包）时：渲染 154×189km 全域地形 / 建筑 / 道路 / 水系 / 地名（各层 1 个 draw call，
 *   视锥分块裁剪），可玩沙盘作为一块「沙盘」嵌在对应片区；相机 500m–200km 对数缩放、预设导航与双击飞抵。
 * - 不传 `map` 时：仅渲染可玩沙盘（PR-04 行为）——东西朝海 48km 大棋盘走这条路径。
 * - 像素化渲染（PixelPass）：低分辨率渲染 + 最近邻放大 + 深度墨线，像素度由本端偏好控制（0 关闭）。
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
import { coreRectWorld } from "@/lib/map/coreArea";
import { SCENE_COLORS } from "@/lib/palette";
import CameraRig from "./CameraRig";
import PixelPass from "./PixelPass";
import RealCityLayers from "./RealCityLayers";
import { usePrefs } from "@/store/prefs";
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
import AmbientTraffic from "./AmbientTraffic";
import ParcelLabels from "./ParcelLabels";
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
  /** 单击空白（没点到任何格）：关闭详情卡等二级界面 */
  onEmptyClick?: () => void;
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
  /** 沙盘自己的地名（东西朝海等大棋盘的 labels.json URL） */
  parcelLabelsUrl?: string | null;
  /** 点到东西朝海管理范围以外 */
  onOutsideCore?: () => void;
  /** 选中的建筑名称牌（详情卡打开时钉在建筑顶上；地标已有固定标签，这里只管普通建筑） */
  selectedLabel?: { r: number; c: number; name: string; height?: number } | null;
  /** 视野中心（世界坐标）变化：HUD 用它在左上角显示"当前在哪个区" */
  onViewTarget?: (x: number, z: number) => void;
  /** 街景层：像素小人与车流的规模参数（人口 / 岗位 / 拥堵 / 幸福度） */
  ambience?: {
    population: number;
    jobs: number;
    congestion: number;
    happiness: number;
  } | null;
  /** 像素度（每个大像素占的 CSS 像素，0 关闭）；缺省读本端偏好 */
  pixelScale?: number;
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

/** 选中建筑的名称牌：每帧把建筑顶点投影到屏幕，钉在 DOM 标签层上 */
function CellBadge({
  parcel,
  offset,
  spot,
  layer,
}: {
  parcel: Parcel;
  offset: [number, number, number];
  spot: { r: number; c: number; name: string; height?: number };
  layer: HTMLDivElement | null;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const el = useRef<HTMLDivElement | null>(null);
  const v = useRef(new THREE.Vector3());
  const g = useMemo(() => gridOf(parcel), [parcel]);

  useEffect(() => {
    if (!layer) return;
    const div = document.createElement("div");
    div.className = "city20-map-label city20-cell-badge";
    div.textContent = spot.name;
    layer.appendChild(div);
    el.current = div;
    return () => {
      div.remove();
      el.current = null;
    };
  }, [layer, spot.name]);

  useFrame(() => {
    const div = el.current;
    if (!div) return;
    const [x, z] = cellToWorld(g, spot.r, spot.c);
    v.current
      .set(x + offset[0], (spot.height ?? 24) + offset[1], z + offset[2])
      .project(camera);
    const px = ((v.current.x + 1) / 2) * size.width;
    const py = ((1 - v.current.y) / 2) * size.height;
    // 在相机背后就不显示
    div.style.display = v.current.z > 1 ? "none" : "block";
    div.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px) translate(-50%, -100%)`;
  });

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
  onEmptyClick,
  cursor,
  map = null,
  initialPreset = "all",
  presetRequest = null,
  labelTopInset = 0,
  mapPickEnabled = true,
  parcelLabelsUrl = null,
  onOutsideCore,
  selectedLabel = null,
  onViewTarget,
  ambience = null,
  debugHook = false,
  pixelScale,
  className,
}: CityScene3DProps) {
  const prefScale = usePrefs((s) => s.pixelScale);
  const hydratePrefs = usePrefs((s) => s.hydrate);
  useEffect(() => hydratePrefs(), [hydratePrefs]);
  // 像素化在本期下线：改用平滑渲染（用户 m03363）。保留开关代码便于回退。
  const PIXEL_ART_ENABLED = false;
  const pixel = PIXEL_ART_ENABLED ? (pixelScale ?? prefScale ?? 0) : 0;
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
  // 左键现在是"拖拽平移"（地图操作逻辑）：拖过一段距离就不要再算成一次点选
  const dragState = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressPickUntil = useRef(0);
  const handlePick = useCallback(
    (cell: Cell) => {
      if (performance.now() < suppressPickUntil.current) return;
      onCellClick?.(cell);
    },
    [onCellClick],
  );

  // 初始机位：只框住当前区（视野约 18km），不是整块 48km 棋盘；
  // 距离落在 maxDistance 之内，否则 OrbitControls 会把相机硬拉近、地形挤出摩尔纹。
  const camPos = useMemo<[number, number, number]>(
    () => [boardExtent * 0.21, boardExtent * 0.44, boardExtent * 0.33],
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

  // 管理范围（东西朝海）：视角与操作都不越出这块矩形
  const core = useMemo(() => (world ? coreRectWorld(world.frame) : null), [world]);

  const shadowCam = boardExtent * 0.62;
  const bg = world ? "#e8f1f6" : SCENE_COLORS.background;

  return (
    <div
      className={`relative h-full w-full min-h-0 min-w-0 ${className ?? ""}`}
      data-testid="city-scene"
      data-map={world ? "full" : "board"}
      data-pixel-scale={pixel}
      style={cursor ? { cursor } : undefined}
      onPointerDown={(e) => {
        if (e.button === 2) rightDown.current = [e.clientX, e.clientY];
        if (e.button === 0) dragState.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const d = dragState.current;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
      }}
      onPointerUp={(e) => {
        const drag = dragState.current;
        dragState.current = null;
        if (e.button === 0 && drag?.moved) suppressPickUntil.current = performance.now() + 220;
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
        shadows={shadowOn ? "basic" : false}
        dpr={[1, coarse ? 1.5 : 2]}
        camera={{ position: camPos, fov: 35, near: 5, far: boardExtent * 8 }}
        flat
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          logarithmicDepthBuffer: true,
        }}
        onPointerMissed={() => {
          handleHover(null);
          onEmptyClick?.();
        }}
      >
        <color attach="background" args={[bg]} />

        <CameraEnvelope
          near={world ? 5 : 5}
          far={world ? 600000 : boardExtent * 8}
        />
        <hemisphereLight
          args={[SCENE_COLORS.hemiSky, world ? "#b8c4cc" : SCENE_COLORS.hemiGround, world ? 1.05 : 1.15]}
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
        {!map && parcelLabelsUrl && (
          <ParcelLabels
            url={parcelLabelsUrl}
            worldSize={boardExtent}
            offset={boardOffset}
            layer={labelLayer}
            topInset={labelTopInset}
          />
        )}
        {!map && selectedLabel && (
          <CellBadge
            parcel={parcel}
            offset={boardOffset}
            spot={selectedLabel}
            layer={labelLayer}
          />
        )}
        {world && map && (
          <MapPicker
            data={map}
            surface={world.surface}
            onFly={onDoubleFly}
            onPick={mapPickEnabled ? onMapPick : undefined}
            onOutOfBounds={onOutsideCore}
          />
        )}
        {world && map && picked && picked.building >= 0 && (
          <SelectionBox
            table={map.table}
            index={picked.building}
            surface={world.surface}
          />
        )}

        {/* 棋盘之外的大地：一圈低饱和草原色垫底，避免"浮岛+虚空"（不依赖雾） */}
        {!world && (
          <mesh
            position={[0, -1.2, 0]}
            rotation-x={-Math.PI / 2}
            receiveShadow={false}
          >
            <planeGeometry args={[boardExtent * 6, boardExtent * 6]} />
            <meshLambertMaterial color={SCENE_COLORS.outerGround} />
          </mesh>
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
          {ambience && networkUrl && (
            <AmbientTraffic
              worldSize={boardExtent}
              networkUrl={networkUrl}
              cellSize={parcel.cell_size_m}
              tiles={tiles}
              population={ambience.population}
              jobs={ambience.jobs}
              congestion={ambience.congestion}
              happiness={ambience.happiness}
              scale={Math.min(4, Math.max(1, boardExtent / 2400))}
            />
          )}
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
          distanceRange={
            world ? [400, 260000] : [420, boardExtent * 0.62]
          }
          bounds={
            core
              ? [core.halfX, core.halfZ]
              : world
                ? [world.frame.width / 2, world.frame.height / 2]
                : [boardExtent * 0.34, boardExtent * 0.34]
          }
          boundsCenter={core ? [core.centerX, core.centerZ] : undefined}
          maxPolarAngle={world ? 1.32 : 1.10}
          onTargetChange={onViewTarget}
          fly={fly}
        />
        {pixel > 1 && <PixelPass pixelScale={pixel} />}
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
