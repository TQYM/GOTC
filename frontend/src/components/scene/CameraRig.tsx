"use client";

/**
 * 相机操控（13 §4.1 天际线式映射，PR-04 先落相机部分；ESC/右键逐级返回、信息视图归 PR-31）：
 * - 左键：留给点选/放置（不驱动相机，防误触）
 * - 右键拖拽：环绕旋转与俯仰；中键拖拽：平移
 * - 滚轮：向光标位置缩放
 * - WASD / 方向键：平移，速度随缩放级别自适应
 * - Home：回到默认鸟瞰
 * - 触屏（09 §5）：单指平移、双指捏合缩放 + 旋转
 */
import { useCallback, useEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyA: [0, -1],
  ArrowLeft: [0, -1],
  KeyD: [0, 1],
  ArrowRight: [0, 1],
};

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName))
  );
}

export interface CameraRigProps {
  extent: number;
  home: [number, number, number];
  /** 值变化时回到默认鸟瞰（供页面上的「回到全景」按钮使用） */
  resetSignal?: number;
  /** 缩放距离范围（米）；全域地图 500m–200km，滚轮为乘法缩放（对数尺度） */
  distanceRange?: [number, number];
  /** 视点可平移范围（世界坐标半宽 [x, z]），缺省为 extent × 0.6 */
  bounds?: [number, number];
  /** 视点可平移范围的矩形中心（缺省原点；全域模式用于把视角锁在东西朝海） */
  boundsCenter?: [number, number];
  /** 最大俯仰角（弧度）：越小越限制平视，避免露出地图边缘外的虚空 */
  maxPolarAngle?: number;
  /** 飞行请求：token 变化时在 duration ms 内平滑飞到目标机位（0 = 瞬移） */
  fly?: {
    pos: [number, number, number];
    target: [number, number, number];
    token: number;
    duration: number;
  } | null;
}

const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export default function CameraRig({
  extent,
  home,
  resetSignal = 0,
  distanceRange,
  bounds,
  boundsCenter,
  maxPolarAngle = 1.32,
  fly = null,
}: CameraRigProps) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const pressed = useRef(new Set<string>());

  const resetView = useCallback(() => {
    const c = controls.current;
    if (c) {
      // 先在无阻尼下消化残余惯性，再落到默认机位，避免复位后继续漂移
      c.enableDamping = false;
      c.update();
      camera.position.set(...home);
      c.target.set(0, 0, 0);
      c.update();
      c.enableDamping = true;
    } else {
      camera.position.set(...home);
    }
  }, [camera, home]);

  useEffect(() => {
    if (resetSignal) resetView();
    // 仅在信号变化时复位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  useEffect(() => {
    const keys = pressed.current;
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === "Home") {
        resetView();
        return;
      }
      if (PAN_KEYS[e.code]) {
        keys.add(e.code);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const clear = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [resetView]);

  // 平滑飞行（预设导航 / 双击飞抵）：位置与视点同时插值，玩家一拖拽就中止
  const flight = useRef<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    tFrom: THREE.Vector3;
    tTo: THREE.Vector3;
    start: number;
    duration: number;
  } | null>(null);
  useEffect(() => {
    const c = controls.current;
    if (!fly || !c) return;
    const to = new THREE.Vector3(...fly.pos);
    const tTo = new THREE.Vector3(...fly.target);
    if (fly.duration <= 0) {
      c.enableDamping = false;
      c.update();
      c.object.position.copy(to);
      c.target.copy(tTo);
      c.update();
      c.enableDamping = true;
      flight.current = null;
      return;
    }
    flight.current = {
      from: c.object.position.clone(),
      to,
      tFrom: c.target.clone(),
      tTo,
      start: performance.now(),
      duration: fly.duration,
    };
    const cancel = () => (flight.current = null);
    c.addEventListener("start", cancel);
    return () => c.removeEventListener("start", cancel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly?.token]);

  // 兜底：任何操作（拖拽平移 / zoomToCursor）之后都把视点拉回允许范围
  // R3F 惯用法：useFrame 回调内直接改 camera/controls，immutability 规则在此不适用
  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const [limX, limZ] = bounds ?? [extent * 0.6, extent * 0.6];
    const [cx, cz] = boundsCenter ?? [0, 0];
    const nx = THREE.MathUtils.clamp(c.target.x, cx - limX, cx + limX);
    const nz = THREE.MathUtils.clamp(c.target.z, cz - limZ, cz + limZ);
    if (nx !== c.target.x || nz !== c.target.z) {
      const dx = nx - c.target.x;
      const dz = nz - c.target.z;
      c.target.set(nx, c.target.y, nz);
      camera.position.x += dx;
      camera.position.z += dz;
      c.update();
    }
  });
  /* eslint-enable react-hooks/immutability */

  useFrame(() => {
    const f = flight.current;
    const c = controls.current;
    if (!f || !c) return;
    const t = Math.min(1, (performance.now() - f.start) / f.duration);
    const k = ease(t);
    c.object.position.lerpVectors(f.from, f.to, k);
    c.target.lerpVectors(f.tFrom, f.tTo, k);
    c.update();
    if (t >= 1) flight.current = null;
  });

  const fwd = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || pressed.current.size === 0) return;
    let f = 0;
    let r = 0;
    for (const code of pressed.current) {
      const [df, dr] = PAN_KEYS[code] ?? [0, 0];
      f += df;
      r += dr;
    }
    if (!f && !r) return;
    camera.getWorldDirection(fwd.current);
    fwd.current.y = 0;
    fwd.current.normalize();
    right.current.crossVectors(fwd.current, camera.up).normalize();
    const speed =
      camera.position.distanceTo(c.target) * 0.9 * Math.min(dt, 0.05);
    move.current
      .copy(fwd.current)
      .multiplyScalar(f * speed)
      .addScaledVector(right.current, r * speed);
    // 视点中心不离开地图 / 沙盘太远
    const [limX, limZ] = bounds ?? [extent * 0.6, extent * 0.6];
    const [cx, cz] = boundsCenter ?? [0, 0];
    const nx = THREE.MathUtils.clamp(c.target.x + move.current.x, cx - limX, cx + limX);
    const nz = THREE.MathUtils.clamp(c.target.z + move.current.z, cz - limZ, cz + limZ);
    move.current.set(nx - c.target.x, 0, nz - c.target.z);
    c.target.add(move.current);
    camera.position.add(move.current);
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, 0]}
      enableDamping
      dampingFactor={0.12}
      zoomToCursor
      minDistance={distanceRange ? distanceRange[0] : extent * 0.08}
      maxDistance={distanceRange ? distanceRange[1] : extent * 2.4}
      minPolarAngle={0.15}
      maxPolarAngle={maxPolarAngle}
      screenSpacePanning={false}
      mouseButtons={{ MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
      touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
    />
  );
}
