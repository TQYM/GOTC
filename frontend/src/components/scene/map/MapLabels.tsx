"use client";

/**
 * 地名标签（PR-36）：DOM billboard——始终面向相机、不受雾影响、不占 draw call；每 4 帧刷新一次。
 */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { MapLabel } from "@/lib/map/types";
import { LabelOverlay } from "./labelOverlay";

export default function MapLabels({
  labels,
  layer,
  topInset = 0,
}: {
  labels: MapLabel[];
  layer: HTMLDivElement | null;
  topInset?: number;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const overlay = useRef<LabelOverlay | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    if (!layer) return;
    const o = new LabelOverlay(layer, labels);
    overlay.current = o;
    return () => {
      o.dispose();
      overlay.current = null;
    };
  }, [layer, labels]);

  useFrame(() => {
    frame.current += 1;
    if (frame.current % 4 === 0)
      overlay.current?.update(camera, size.width, size.height, topInset);
  });

  return null;
}
