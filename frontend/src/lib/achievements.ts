/**
 * 成就系统。
 *
 * 设计原则与 C:S 的里程碑不同：里程碑管「解锁什么建筑」（硬门槛），
 * 成就只管「你做到了什么」（纯反馈）。所以这里没有 `unlocks`，也不拦任何操作——
 * 拆掉一座城也不会把成就收回去。
 *
 * 判定全部基于前端已有的 `sim_tick` 视图（metrics / builds_total / districts…），
 * 不新增后端接口：成就本质是「玩家看到的数字跨过了某个阈值」，而这个数字
 * 前端本来就有。代价是**刷新页面后不会补发历史成就**——但解锁记录存在
 * localStorage，已经解锁的不会再弹第二次。
 */

import type { Metrics } from "@/lib/contract";

export type AchievementTone = "ok" | "sun" | "blue" | "grape" | "berry";

export interface Achievement {
  id: string;
  title: string;
  /** 一行说明「怎么拿到的」，弹窗里显示 */
  desc: string;
  /** 单字符图标，与 HUD 的图标风格一致（不用 emoji，避免各平台字形不一） */
  icon: string;
  tone: AchievementTone;
  check: (ctx: AchievementContext) => boolean;
}

export interface AchievementContext {
  metrics: Metrics | null;
  cityYear: number;
  buildsTotal: number;
  districtCount: number;
  transitCount: number;
}

/** 按「达成难度」排序：同一次 tick 里达成多个时，先弹容易的，观感更顺 */
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-build",
    title: "第一铲土",
    desc: "在真实北京的地块上放下第一栋建筑",
    icon: "⌂",
    tone: "sun",
    check: (c) => c.buildsTotal >= 1,
  },
  {
    id: "first-district",
    title: "规划师",
    desc: "划出第一个行政区",
    icon: "▦",
    tone: "blue",
    check: (c) => c.districtCount >= 1,
  },
  {
    id: "first-transit",
    title: "公交先行",
    desc: "开通第一条公交或地铁线路",
    icon: "⇄",
    tone: "grape",
    check: (c) => c.transitCount >= 1,
  },
  {
    id: "pop-1k",
    title: "千人之城",
    desc: "常住人口突破 1,000",
    icon: "◉",
    tone: "ok",
    check: (c) => (c.metrics?.population ?? 0) >= 1_000,
  },
  {
    id: "pop-10k",
    title: "万家灯火",
    desc: "常住人口突破 10,000",
    icon: "◍",
    tone: "ok",
    check: (c) => (c.metrics?.population ?? 0) >= 10_000,
  },
  {
    id: "happy-80",
    title: "幸福之都",
    desc: "市民幸福度达到 80",
    icon: "☺",
    tone: "sun",
    check: (c) => (c.metrics?.happiness ?? 0) >= 80,
  },
  {
    id: "commute-20",
    title: "畅通无阻",
    desc: "平均通勤时间压到 20 分钟以内",
    icon: "⇢",
    tone: "blue",
    check: (c) => {
      const v = c.metrics?.avg_commute;
      // 0 是「还没人通勤」的占位，不能算达成
      return typeof v === "number" && v > 0 && v <= 20;
    },
  },
  {
    id: "green-40",
    title: "绿地之城",
    desc: "绿地覆盖率达到 40%",
    icon: "❦",
    tone: "ok",
    check: (c) => (c.metrics?.green_ratio ?? 0) >= 0.4,
  },
  {
    id: "land-80",
    title: "寸土寸金",
    desc: "地价指数冲到 80",
    icon: "¥",
    tone: "berry",
    check: (c) => (c.metrics?.land_price_index ?? 0) >= 80,
  },
  {
    id: "full-employment",
    title: "充分就业",
    desc: "职住比达到 0.95",
    icon: "⚒",
    tone: "grape",
    check: (c) => (c.metrics?.job_res_ratio ?? 0) >= 0.95,
  },
  {
    id: "rich-100m",
    title: "亿元户",
    desc: "城市财政突破 1 亿",
    icon: "◈",
    tone: "sun",
    check: (c) => (c.metrics?.funds ?? 0) >= 100_000_000,
  },
  {
    id: "year-10",
    title: "十年一梦",
    desc: "连续经营到第 10 年",
    icon: "◷",
    tone: "blue",
    check: (c) => c.cityYear >= 11,
  },
];

const STORAGE_KEY = "city20.achievements.v1";

/** 已解锁的 id 集合；localStorage 不可用（隐私模式 / SSR）时降级为空集。 */
export function loadUnlocked(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function saveUnlocked(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // 配额满 / 隐私模式：成就只是反馈，写不进去就算了
  }
}

/**
 * 返回本次新达成的成就（已解锁的会被过滤掉）。
 *
 * 顺序按 `ACHIEVEMENTS` 声明序，调用方只弹第一个、其余排队。
 */
export function detectNew(
  ctx: AchievementContext,
  unlocked: Set<string>,
): Achievement[] {
  const out: Achievement[] = [];
  for (const item of ACHIEVEMENTS) {
    if (unlocked.has(item.id)) continue;
    try {
      if (item.check(ctx)) out.push(item);
    } catch {
      // 单个成就的判定不该拖垮整轮检测
    }
  }
  return out;
}
