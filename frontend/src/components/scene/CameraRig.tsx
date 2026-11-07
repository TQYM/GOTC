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
}

export default function CameraRig({
  extent,
  home,
  resetSignal = 0,
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
    // 视点中心不离开沙盘太远
    const lim = extent * 0.6;
    const nx = THREE.MathUtils.clamp(c.target.x + move.current.x, -lim, lim);
    const nz = THREE.MathUtils.clamp(c.target.z + move.current.z, -lim, lim);
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
      minDistance={extent * 0.08}
      maxDistance={extent * 2.4}
      minPolarAngle={0.15}
      maxPolarAngle={1.32}
      screenSpacePanning={false}
      mouseButtons={{ MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
      touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
    />
  );
}
