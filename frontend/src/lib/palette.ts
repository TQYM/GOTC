/**
 * 卡通风格配色（11 §6.0，取代 05 §4 旧色板）：全局高明度、中高饱和。
 * 3D 场景与 CSS 图例共用这里的十六进制值。
 */
import type { Terrain } from "./contract";
import type { TileCategory } from "./catalog";

/** 地形：flat 米白 / hill 浅赭 / river 卡通蓝 / bank 浅蓝 / forest 青绿 / road 浅灰；occupied 既有建筑 pastel 灰白 */
export const TERRAIN_COLORS: Record<Terrain, string> = {
  flat: "#F5F0E6",
  hill: "#D9C7A7",
  river: "#7EC8E3",
  bank: "#BFE3F2",
  forest: "#8FD19E",
  road_inherited: "#C9CDD3",
  occupied: "#E8E6E1",
};

/** 玩家建筑大类：住宅暖黄、商业金橙、工业雾紫、绿地青绿、服务珊瑚红、交通天蓝、市政灰蓝 */
export const CATEGORY_COLORS: Record<TileCategory, string> = {
  residential: "#FFC94D",
  commercial: "#FF9F43",
  industrial: "#A29BFE",
  green: "#2ECC9B",
  service: "#FF6B6B",
  transport: "#54A0FF",
  utility: "#8395A7",
};

/** 场景辅助色 */
export const SCENE_COLORS = {
  background: "#cfe6f2",
  plinth: "#5b6b7d",
  riverbed: "#4f9fc4",
  water: "#7EC8E3",
  existingBuilding: "#D5D2CC",
  trunk: "#9b7653",
  treeCrown: "#5cbf72",
  grid: "#7a8796",
  hover: "#ffffff",
  valid: "#2ecc71",
  invalid: "#ff4d4f",
  accentLight: "#ffffff",
  accentDark: "#5a6270",
  asphalt: "#9aa1ab",
  roofTint: "#fff3d6",
} as const;
