"use client";

/**
 * 全域地图加载：Web Worker 下载 + 预处理（不阻塞主线程，加载期间进度可见），结果按沙盘规格缓存。
 * 数据来自静态文件 /data/parcels/beijing_full/*.json（scripts/sync-map-data.mjs 同步），不调用后端。
 */
import { useEffect, useState } from "react";
import { boardOriginUtm, type BoardSpec } from "@/components/scene/coords";
import type { FullMapData, LoadStage, WorkerOut } from "./types";

export const MAP_BASE = "/data/parcels/beijing_full/";

export interface MapProgress {
  stage: LoadStage;
  /** 0–1 总进度 */
  ratio: number;
  loadedBytes?: number;
  totalBytes?: number;
}

type Board = BoardSpec | null;

function boardKey(b: Board) {
  if (!b) return "none";
  const [e, n] = boardOriginUtm(b);
  return `${b.size}x${b.cell_size_m}@${e.toFixed(1)},${n.toFixed(1)}`;
}

const WEIGHTS: Record<LoadStage, [number, number]> = {
  download: [0, 0.72],
  terrain: [0.72, 0.8],
  buildings: [0.8, 0.92],
  network: [0.92, 0.98],
  labels: [0.98, 0.99],
  upload: [0.99, 1],
};

export const STAGE_LABEL: Record<LoadStage, string> = {
  download: "下载北京全域数据包",
  terrain: "生成地形",
  buildings: "生成建筑",
  network: "生成道路与水系",
  labels: "整理地名",
  upload: "上传到显卡",
};

const cache = new Map<string, Promise<FullMapData>>();
const listeners = new Map<string, Set<(p: MapProgress) => void>>();

function load(board: Board): Promise<FullMapData> {
  const key = boardKey(board);
  let p = cache.get(key);
  if (p) return p;
  p = new Promise<FullMapData>((resolve, reject) => {
    const worker = new Worker(new URL("./fullmap.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.type === "progress") {
        const [a, b] = WEIGHTS[m.stage];
        const prog: MapProgress = {
          stage: m.stage,
          ratio: a + (b - a) * m.ratio,
          loadedBytes: m.loadedBytes,
          totalBytes: m.totalBytes,
        };
        for (const fn of listeners.get(key) ?? []) fn(prog);
      } else if (m.type === "done") {
        worker.terminate();
        resolve(m.data);
      } else {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "地图 worker 启动失败"));
    };
    worker.postMessage({ type: "load", base: MAP_BASE, board });
  });
  p.catch(() => cache.delete(key)); // 失败可重试
  cache.set(key, p);
  return p;
}

export type MapState =
  | { status: "off" }
  | { status: "loading"; progress: MapProgress }
  | { status: "ready"; data: FullMapData }
  | { status: "error"; message: string };

const INITIAL: MapState = {
  status: "loading",
  progress: { stage: "download", ratio: 0 },
};

/** 加载全域地图；board 为可玩沙盘规格（null = 不放沙盘） */
export function useFullMap(
  board: Board,
  enabled = true,
): {
  state: MapState;
  retry: () => void;
} {
  const [state, setState] = useState<MapState>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const key = boardKey(board);
  const size = board?.size;
  const cell = board?.cell_size_m;
  const [oe, on] = board ? boardOriginUtm(board) : [0, 0];

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const b =
      size !== undefined && cell !== undefined
        ? { size, cell_size_m: cell, origin: [oe, on] }
        : null;
    const onProg = (progress: MapProgress) =>
      alive && setState({ status: "loading", progress });
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(onProg);
    load(b).then(
      (data) => alive && setState({ status: "ready", data }),
      (e: Error) => alive && setState({ status: "error", message: e.message }),
    );
    return () => {
      alive = false;
      set!.delete(onProg);
    };
  }, [key, size, cell, oe, on, attempt, enabled]);

  return {
    state: enabled ? state : ({ status: "off" } as const),
    retry: () => {
      setState(INITIAL);
      setAttempt((n) => n + 1);
    },
  };
}
