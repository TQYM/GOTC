"use client";

/**
 * 全域拾取（PR-36）：
 * - 单击（无拖拽）：视线与「地表 + 格内建筑顶高」求交 → 格 → cells 索引 → 建筑下标，交给上层弹面板；
 *   命中沙盘矩形时不处理（沙盘自己的放置 / 拆除拾取不变）。
 * - 双击：同样求交后飞抵该点。
 * 不对 73 万格网格或 7 万栋建筑做三角面拾取，开销与地图规模无关。
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { mapPointToCell } from "@saves/lib/cityModel";
import type { FullMapData } from "@/lib/map/types";
import type { CameraShot } from "@/lib/map/presets";
import { cellTopHeights, marchHeightfield } from "@/lib/map/pick";
import { mapFrame, worldToMap, type Surface } from "../coords";
import { inCoreArea } from "@/lib/map/coreArea";

export interface MapPick {
  /** 建筑表下标（只在命中建筑时回调，空地回调 null） */
  building: number;
  cell: [number, number];
  /** 地图局部坐标 */
  x: number;
  y: number;
}

export default function MapPicker({
  data,
  surface,
  onFly,
  onPick,
  onOutOfBounds,
}: {
  data: FullMapData;
  surface: Surface;
  onFly: (shot: CameraShot) => void;
  onPick?: (pick: MapPick | null) => void;
  /** 点到东西朝海以外的区域（管理范围外） */
  onOutOfBounds?: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
  } | null;
  const tops = useMemo(
    () => cellTopHeights(data.cellIndex, data.table.height),
    [data],
  );

  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const { rows, cols, cell_m } = data.grid;
    const heightAt = (wx: number, wz: number) => {
      const [mx, my] = worldToMap(surface.f, wx, wz);
      const ground = surface.heightAt(mx, my);
      const c = mapPointToCell(mx, my, rows, cols, cell_m);
      return c ? ground + tops[c[0] * cols + c[1]] : ground;
    };
    const cast = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const t = marchHeightfield(ray.ray, heightAt);
      if (t === null) return null;
      return new THREE.Vector3()
        .copy(ray.ray.direction)
        .multiplyScalar(t)
        .add(ray.ray.origin);
    };
    const inBoard = (x: number, y: number) => {
      const b = data.boardRect;
      return !!b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
    };

    const onDbl = (e: MouseEvent) => {
      const p = cast(e);
      if (!p) return;
      const tgt = controls?.target ?? p;
      const dir = new THREE.Vector3()
        .subVectors(camera.position, tgt)
        .normalize();
      const dist = Math.max(600, camera.position.distanceTo(tgt) * 0.35);
      const pos = p.clone().addScaledVector(dir, dist);
      onFly({ pos: [pos.x, pos.y, pos.z], target: [p.x, p.y, p.z] });
    };

    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? [e.clientX, e.clientY] : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!onPick || !down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > 5) return; // 拖拽是旋转 / 平移，不算点击
      const p = cast(e);
      if (!p) return onPick(null);
      const [x, y] = worldToMap(surface.f, p.x, p.z);
      if (inBoard(x, y)) return onPick(null);
      // 管理范围只到东西朝海：范围外只提示，不弹建筑详情
      if (!inCoreArea(mapFrame(data.grid), x, y)) {
        onOutOfBounds?.();
        return onPick(null);
      }
      const cell = mapPointToCell(x, y, rows, cols, cell_m);
      if (!cell) return onPick(null);
      const building = data.cellIndex[cell[0] * cols + cell[1]];
      onPick(building >= 0 ? { building, cell, x, y } : null);
    };
    el.addEventListener("dblclick", onDbl);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("dblclick", onDbl);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
    };
  }, [gl, camera, controls, surface, data, tops, onFly, onPick, onOutOfBounds]);

  return null;
}
