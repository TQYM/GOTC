/**
 * 区块目录（01 §3）的前端镜像：身份、大类、占地、造价。
 * 只用于展示与本地预校验；造价/合法性以后端为准（02 §0.1）。
 */
import type { TileType } from "./contract";

export type TileCategory =
  | "residential"
  | "commercial"
  | "industrial"
  | "green"
  | "service"
  | "transport"
  | "utility";

export interface TileSpec {
  type: TileType;
  name: string;
  category: TileCategory;
  /** [高, 宽]（格）；util_bridge 为 1×N，N 由河道宽度决定，此处记 1×1 */
  footprint: [number, number];
  /** 总造价（元）；util_bridge 为每格单价 */
  cost: number;
  /** 卡面一句人话（14 §2.1）：住多少人 / 多少岗位 / 起什么作用；数值取自 sim-config（03 §8），仅展示 */
  blurb: string;
}

export const TILE_SPECS: Record<TileType, TileSpec> = {
  res_low: {
    type: "res_low",
    name: "低层住宅",
    category: "residential",
    footprint: [1, 1],
    cost: 80_000,
    blurb: "住 300 人",
  },
  res_mid: {
    type: "res_mid",
    name: "多层住宅",
    category: "residential",
    footprint: [1, 1],
    cost: 220_000,
    blurb: "住 900 人",
  },
  res_high: {
    type: "res_high",
    name: "高层住宅",
    category: "residential",
    footprint: [1, 1],
    cost: 600_000,
    blurb: "住 2400 人",
  },
  com_shop: {
    type: "com_shop",
    name: "社区商业",
    category: "commercial",
    footprint: [1, 1],
    cost: 300_000,
    blurb: "80 个岗位",
  },
  com_cbd: {
    type: "com_cbd",
    name: "商务中心",
    category: "commercial",
    footprint: [2, 2],
    cost: 2_200_000,
    blurb: "1200 个岗位",
  },
  ind_light: {
    type: "ind_light",
    name: "轻工业",
    category: "industrial",
    footprint: [2, 2],
    cost: 1_500_000,
    blurb: "900 个岗位",
  },
  ind_heavy: {
    type: "ind_heavy",
    name: "重工业",
    category: "industrial",
    footprint: [3, 3],
    cost: 4_000_000,
    blurb: "2600 个岗位 · 有污染",
  },
  green_park: {
    type: "green_park",
    name: "公园绿地",
    category: "green",
    footprint: [1, 1],
    cost: 150_000,
    blurb: "提升幸福度",
  },
  green_plaza: {
    type: "green_plaza",
    name: "城市广场",
    category: "green",
    footprint: [2, 2],
    cost: 500_000,
    blurb: "地标 · 带动地价",
  },
  edu_school: {
    type: "edu_school",
    name: "学校",
    category: "service",
    footprint: [2, 2],
    cost: 1_200_000,
    blurb: "孩子就近上学",
  },
  med_clinic: {
    type: "med_clinic",
    name: "医院",
    category: "service",
    footprint: [2, 2],
    cost: 2_000_000,
    blurb: "看病不用跑远",
  },
  trans_metro: {
    type: "trans_metro",
    name: "地铁站",
    category: "transport",
    footprint: [1, 1],
    cost: 3_000_000,
    blurb: "通勤大幅缩短",
  },
  trans_road: {
    type: "trans_road",
    name: "城市道路",
    category: "transport",
    footprint: [1, 1],
    cost: 60_000,
    blurb: "补路网",
  },
  util_bridge: {
    type: "util_bridge",
    name: "跨河桥",
    category: "utility",
    footprint: [1, 1],
    cost: 200_000,
    blurb: "跨河通行 · 按格计价",
  },
};

/** 工具栏展示顺序（01 §3 表序） */
export const TILE_ORDER: TileType[] = Object.keys(TILE_SPECS) as TileType[];
