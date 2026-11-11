import type { ReportResult, TileType } from "./types";

export const TILE_LABELS: Record<TileType, string> = {
  res_low: "低密住宅", res_mid: "中密住宅", res_high: "高密住宅",
  com_shop: "社区商业", com_cbd: "商务中心", ind_light: "轻型产业", ind_heavy: "重工业",
  green_park: "城市公园", green_plaza: "公共广场", edu_school: "学校", med_clinic: "医院",
  trans_metro: "地铁站", trans_road: "道路", trans_avenue: "城市大道",
  trans_highway: "城市高速", util_bridge: "桥梁",
  srv_police: "警察局", srv_fire: "消防局", srv_garbage: "垃圾处理厂",
  srv_sewage: "污水处理厂", srv_power: "发电厂", srv_water: "自来水厂",
};

export const ENDING_LABELS: Record<ReportResult["ending"], string> = {
  bankrupt: "财政承压", eco_paradise: "生态宜居", gridlock: "通勤高压",
  ghost_town: "人气不足", thriving: "活力城区", ordinary: "稳健发展",
};

export const SCORE_LABELS = {
  population: "人口", balance: "财政", green: "绿色", traffic: "交通", happiness: "幸福",
} as const;

export const TERRAIN_LABELS = {
  flat: "空地", hill: "丘陵", river: "水域", bank: "河岸", forest: "绿地",
  road_inherited: "既有道路", occupied: "现状建筑",
} as const;

export function formatMoney(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)} 万`;
  return new Intl.NumberFormat("zh-CN").format(value);
}
