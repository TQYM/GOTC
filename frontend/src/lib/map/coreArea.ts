/**
 * 管理范围：北京城四区（东城、西城、朝阳、海淀）。
 *
 * 「地图扩大全北京，但视角与操作只到东西朝海」（m02002）：
 * - 相机视点被钳制在核心区矩形内（看到全城，但飞不到延庆、房山）；
 * - 点击核心区以外的建筑只提示「超出管理范围」，不弹详情、不可建造。
 *
 * 坐标换算：数据包局部米制坐标与经纬度线性对应，核心区矩形由全域 bbox 比例换算而来。
 */
import { mapToWorld, worldToMap, type MapFrame } from "@/components/scene/coords";

export const FULL_BBOX = { south: 39.4, west: 115.6, north: 41.1, east: 117.5 };
export const CORE_BBOX = { south: 39.75, west: 116.1, north: 40.1, east: 116.66 };

export interface CoreRectMap {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface CoreRectWorld {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  halfX: number;
  halfZ: number;
}

/** 核心区在数据包局部米制坐标中的矩形 */
export function coreRectMap(f: MapFrame): CoreRectMap {
  const fx = (lon: number) => ((lon - FULL_BBOX.west) / (FULL_BBOX.east - FULL_BBOX.west)) * f.width;
  const fy = (lat: number) => ((lat - FULL_BBOX.south) / (FULL_BBOX.north - FULL_BBOX.south)) * f.height;
  return {
    x0: fx(CORE_BBOX.west),
    x1: fx(CORE_BBOX.east),
    y0: fy(CORE_BBOX.south),
    y1: fy(CORE_BBOX.north),
  };
}

/** 核心区在世界坐标中的矩形（北 = −z） */
export function coreRectWorld(f: MapFrame): CoreRectWorld {
  const r = coreRectMap(f);
  const [minX, maxZ] = mapToWorld(f, r.x0, r.y0);
  const [maxX, minZ] = mapToWorld(f, r.x1, r.y1);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    halfX: (maxX - minX) / 2,
    halfZ: (maxZ - minZ) / 2,
  };
}

/** 局部米制坐标是否落在管理范围内 */
export function inCoreArea(f: MapFrame, x: number, y: number): boolean {
  const r = coreRectMap(f);
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** 世界坐标是否落在管理范围内 */
export function inCoreWorld(f: MapFrame, wx: number, wz: number): boolean {
  const [x, y] = worldToMap(f, wx, wz);
  return inCoreArea(f, x, y);
}
