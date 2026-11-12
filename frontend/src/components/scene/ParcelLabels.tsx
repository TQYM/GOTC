"use client";

/**
 * 沙盘地名标签（东西朝海 48km 棋盘）：复用 LabelOverlay 的 LOD + 贪心避让。
 * 数据来自 parcel 的 labels.json（局部米制坐标），转成世界坐标后交给 DOM billboard 层。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { MapLabel } from "@/lib/map/types";
import { LabelOverlay } from "./map/labelOverlay";

interface ParcelLabelItem {
  name?: string;
  kind?: string;
  x: number;
  y: number;
  importance?: number;
}

export default function ParcelLabels({
  url,
  worldSize,
  offset,
  layer,
  topInset = 0,
}: {
  url: string;
  worldSize: number;
  offset: [number, number, number];
  layer: HTMLDivElement | null;
  topInset?: number;
}) {
  const [loaded, setLoaded] = useState<{ url: string; items: ParcelLabelItem[] } | null>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const overlay = useRef<LabelOverlay | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { labels?: ParcelLabelItem[] } | null) => {
        if (alive) setLoaded({ url, items: json?.labels ?? [] });
      })
      .catch(() => alive && setLoaded({ url, items: [] }));
    return () => {
      alive = false;
    };
  }, [url]);

  const items = loaded && loaded.url === url ? loaded.items : null;
  const labels = useMemo<MapLabel[]>(() => {
    if (!items) return [];
    const half = worldSize / 2;
    // 48km 棋盘有 3400+ 条地名：只留 3 级以上、按重要性取前 900 条（DOM 标签每 4 帧遍历，过多会拖慢主线程）
    const picked = items
      .filter(
        (l) =>
          l.name &&
          Number.isFinite(l.x) &&
          Number.isFinite(l.y) &&
          (l.importance ?? 3) >= 3,
      )
      .sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3))
      .slice(0, 240);
    return picked
      .map((l) => ({
        name: l.name as string,
        kind: l.kind ?? "place",
        importance: l.importance ?? 3,
        x: -half + l.x + offset[0],
        y: 8,
        z: half - l.y + offset[2],
      }));
  }, [items, worldSize, offset]);

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
