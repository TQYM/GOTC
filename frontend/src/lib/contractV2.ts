/**
 * API v2 预备类型（10-persistence-sync.md §3/§5：不限时 + SQLite 存档 + 多端同步）。
 *
 * 10 号文档声明其 REST/SSE 表将替换 02 的 v1 表，但 02 正文尚未升版、后端 PR-23 尚未落地。
 * 这里只收录 10 号文档已明确写出的字段，供 PR-15/PR-25 起步；后端落地后以 02 v2 正文为准逐字对齐。
 */
import type { Cell, Metrics, MetricsDiff, Parcel, Tile } from "./contract";

/** 10 §3：4 态，全部由玩家主动流转，无任何倒计时 */
export type PhaseV2 = "briefing" | "building" | "projecting" | "report";

/** 10 §4：8 位 Crockford Base32 城市码 */
export type CityCode = string;

/** POST /api/saves 响应（10 §5） */
export interface SaveCreated {
  save_id: string;
  city_code: CityCode;
  parcel: Parcel;
  tiles: Tile[];
  metrics: Metrics;
  city_year: number;
  phase: PhaseV2;
}

/** GET /api/saves/{city_code} 全量恢复（10 §5） */
export interface SaveState {
  parcel: Parcel;
  tiles: Tile[];
  metrics: Metrics;
  city_year: number;
  phase: PhaseV2;
  last_seq: number;
}

/** 写操作的公共幂等字段（10 §4/§6） */
export interface OpMeta {
  client_op_id: string;
  base_seq: number;
}

/** 10 §5 SSE 事件名：tick 删除，新增 op_applied / city_year */
export type SseEventNameV2 =
  | "op_applied"
  | "city_year"
  | "phase_change"
  | "news"
  | "citizen"
  | "mentor"
  | "projection_step"
  | "report_ready"
  | "error";

/** op_applied：多端同步核心（10 §6）；seq 跳号时前端走 GET 全量恢复 */
export interface OpAppliedEvent {
  seq: number;
  op_type: "place" | "remove" | "advance";
  payload: unknown;
  metrics_diff: MetricsDiff;
}

/** 前端本地工具：格坐标与 v2 请求中 anchor_r / anchor_c 的互转 */
export function anchorFields([r, c]: Cell) {
  return { anchor_r: r, anchor_c: c };
}
