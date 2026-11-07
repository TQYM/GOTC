"use client";

/**
 * CityScene3D（05 §2.3 / 11 §6）：卡通风格真 3D 沙盘。
 *
 * - 透视相机 + 天际线式操控（CameraRig：右键旋转、中键/WASD 平移、滚轮向光标缩放、Home 复位）；
 * - 米制局部坐标，片区中心为原点；
 * - 1 方向光 + 半球环境光，关闭色调映射（flat）保留卡通高饱和配色；
 * - 桌面开阴影，触屏设备关阴影并把像素比上限压到 1.5；
 * - 只渲染契约数据（parcel + tiles[].cells），不推断任何业务规则。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Cell, Parcel, Tile } from "@/lib/contract";
import { SCENE_COLORS } from "@/lib/palette";
import CameraRig from "./CameraRig";
import RealCityLayers from "./RealCityLayers";
import { cellToWorld, gridOf, TERRAIN_HEIGHT } from "./coords";
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

export type { GhostSpec } from "./layers";

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
  /** 强制开关阴影；缺省按设备（触屏关） */
  shadows?: boolean;
  /** 额外格框高亮（拆除模式选中的区块等） */
  overlay?: { cells: Cell[]; color: string } | null;
  /** 右键单击（无拖拽）：退出当前工具（13 §4.1） */
  onRightClick?: () => void;
  /** 画布光标样式（放置 / 拆除模式换光标） */
  cursor?: string;
  /** 值变化时相机回到默认鸟瞰 */
  resetViewSignal?: number;
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

/** E2E 钩子：把格中心投影到 canvas 像素坐标，用于校验拾取零偏移 */
function DebugHook({ parcel }: { parcel: Parcel }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const g = gridOf(parcel);
    const api = {
      cellToScreen(r: number, c: number): [number, number] {
        const [x, z] = cellToWorld(g, r, c);
        const t = parcel.terrain[r][c];
        const v = new THREE.Vector3(x, TERRAIN_HEIGHT[t], z).project(camera);
        return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
      },
    };
    (window as unknown as { __city20Scene?: typeof api }).__city20Scene = api;
    return () => {
      delete (window as unknown as { __city20Scene?: typeof api })
        .__city20Scene;
    };
  }, [camera, size, parcel]);
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
  debugHook = false,
  className,
}: CityScene3DProps) {
  const rightDown = useRef<[number, number] | null>(null);
  const coarse = useCoarsePointer();
  const shadowOn = shadows ?? !coarse;
  const [hover, setHover] = useState<Cell | null>(null);
  const hoverRef = useRef<Cell | null>(null);
  const extent = parcel.size * parcel.cell_size_m;

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
    () => [extent * 0.92, extent * 1.2, extent * 1.4],
    [extent],
  );
  const shadowCam = extent * 0.62;

  return (
    <div
      className={`relative h-full w-full min-h-0 min-w-0 ${className ?? ""}`}
      data-testid="city-scene"
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
        camera={{ position: camPos, fov: 35, near: 10, far: extent * 8 }}
        flat
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => handleHover(null)}
      >
        <color attach="background" args={[SCENE_COLORS.background]} />
        <fog
          attach="fog"
          args={[SCENE_COLORS.background, extent * 2.2, extent * 5]}
        />
        <hemisphereLight args={["#ffffff", "#c9d6b8", 1.15]} />
        <directionalLight
          position={[extent * 0.45, extent * 0.9, extent * 0.3]}
          intensity={1.7}
          castShadow={shadowOn}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-shadowCam}
          shadow-camera-right={shadowCam}
          shadow-camera-top={shadowCam}
          shadow-camera-bottom={-shadowCam}
          shadow-camera-near={10}
          shadow-camera-far={extent * 3}
          shadow-bias={-0.0004}
          shadow-normalBias={1.5}
        />

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
            worldSize={extent}
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

        <CameraRig
          extent={extent}
          home={camPos}
          resetSignal={resetViewSignal}
        />
        {onStats && <StatsProbe onStats={onStats} />}
        {debugHook && <DebugHook parcel={parcel} />}
      </Canvas>
    </div>
  );
}
