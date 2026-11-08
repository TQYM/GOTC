/**
 * 全域地图（北京 154×189km）前端数据形状：worker 把 35MB JSON 预处理成可直接上 GPU 的类型化数组。
 * 原始数据形状见 data/parcels/beijing_full（PR-36 数据包），这里不新增任何后端接口。
 */

/**
 * 分槽几何：每个槽 = 一个空间分块 × 一个 LOD 部件，占一段连续顶点（与可选索引）。
 * 主线程把每个槽装成 BatchedMesh 的一个实例：视锥裁剪 + 按相机到槽包围盒的距离切换可见性，仍只算 1 次 draw call。
 */
export interface ChunkedGeometry {
  position: Float32Array;
  /** Int8 归一化法线（省显存：3B / 顶点） */
  normal: Int8Array;
  /** 顶点色（RGB，0–255，线性空间）；地形用纹理着色时为 null */
  color: Uint8Array | null;
  /** 槽内局部索引（相对本槽首顶点）；非索引几何为 null */
  index: Uint32Array | null;
  /** 每槽 [顶点起点, 顶点数, 索引起点, 索引数]，展平存放 */
  chunks: Int32Array;
  /** 每槽世界包围盒 [minX, minY, minZ, maxX, maxY, maxZ] */
  boxes: Float32Array;
  /** 每槽可见距离带 [近, 远)（米，相机到包围盒的距离） */
  bands: Float32Array;
  /** 每槽部件编号（图层内含义见 BUILDING_PART 等） */
  parts: Uint8Array;
}

/** 建筑 LOD 部件：<5km 精细（base+mid+fine）/ 5–15km 中模（base+mid）/ 15–30km 无细节（base）/ >30km 简模（simple） */
export const BUILDING_PART = {
  base: 0,
  mid: 1,
  fine: 2,
  simple: 3,
  landmark: 4,
  /** 沙盘矩形内的地标：沙盘自带真实建筑时隐藏，避免重影 */
  boardLandmark: 5,
} as const;

export const LOD_DISTANCE = {
  fine: 5000,
  medium: 15000,
  noDetail: 30000,
} as const;

/** 拾取 / 面板用的紧凑建筑表（见 lib/cityModel.ts BuildingTable） */
import type { BuildingTable } from "@saves/lib/cityModel";
export type { BuildingTable };

export interface MapLabel {
  name: string;
  importance: number;
  kind: string;
  /** 世界坐标 */
  x: number;
  y: number;
  z: number;
}

export interface MapLandmark {
  key: string;
  name: string;
  /** 地图局部坐标（x 东, y 北）与高度 */
  x: number;
  y: number;
  height: number;
}

export interface FullMapData {
  grid: { rows: number; cols: number; cell_m: number };
  bbox: { south: number; west: number; north: number; east: number };
  /** rows×cols 行主序，行自南向北 */
  elevation: Float32Array;
  /** cols×rows RGBA，第 0 行 = 最南行（纹理 v=0） */
  terrainRGBA: Uint8Array;
  terrain: ChunkedGeometry;
  buildings: ChunkedGeometry;
  /** rows×cols：格 → 建筑表下标（-1 = 空），按格拾取用 */
  cellIndex: Int32Array;
  table: BuildingTable;
  /** 沙盘在全域上的矩形（局部米制），null = 无沙盘 */
  boardRect: { x0: number; y0: number; x1: number; y1: number } | null;
  roads: ChunkedGeometry;
  water: ChunkedGeometry;
  labels: MapLabel[];
  landmarks: MapLandmark[];
  /** 第一个乡村聚落中心（预设导航「乡村」） */
  village: [number, number] | null;
  stats: {
    buildings: number;
    landmarkDuplicatesRemoved: number;
    triangles: Record<string, number>;
    urban: number;
    rural: number;
    roads: number;
    labels: number;
    hiddenUnderBoard: number;
    /** 各阶段耗时（ms），用于性能记录 */
    timings: Record<string, number>;
  };
}

export type LoadStage =
  "download" | "terrain" | "buildings" | "network" | "labels" | "upload";

export type WorkerIn = {
  type: "load";
  base: string;
  /** 可玩沙盘规格：worker 据此算出沙盘在全域上的矩形，其中的普通 / 功能建筑不绘制（地标保留） */
  board: { size: number; cell_size_m: number; origin?: number[] | null } | null;
};

export type WorkerOut =
  | {
      type: "progress";
      stage: LoadStage;
      ratio: number;
      loadedBytes?: number;
      totalBytes?: number;
    }
  | { type: "done"; data: FullMapData }
  | { type: "error"; message: string };
