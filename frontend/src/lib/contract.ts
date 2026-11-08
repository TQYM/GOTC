/**
 * 02 契约的 TypeScript 镜像（docs/plan/02-data-contract.md v1 + 11 §7 的 v1.1 只增扩展）。
 *
 * 纪律：字段名/枚举值与 02 文档逐字一致；改契约先改 02 文档，再改这里。
 * 前端不得依赖本文件之外的任何后端字段或行为。
 * 注：不限时改造（10 号文档：city_year / saves / op_applied）尚未写入 02 正文，落地时再同步。
 */

/** [r, c]：行（北→南）、列（西→东），原点西北角（01 §1） */
export type Cell = [number, number];

/** 01 §2 地形枚举；`occupied`（既有建筑）为 v1.1 新增（11 §5） */
export type Terrain =
  "flat" | "hill" | "river" | "bank" | "forest" | "road_inherited" | "occupied";

/** 01 §3 区块 id */
export type TileType =
  | "res_low"
  | "res_mid"
  | "res_high"
  | "com_shop"
  | "com_cbd"
  | "ind_light"
  | "ind_heavy"
  | "green_park"
  | "green_plaza"
  | "edu_school"
  | "med_clinic"
  | "trans_metro"
  | "trans_road"
  | "util_bridge";

/** 02 §5：saves v2 持久化只用 briefing/building；projecting/report 为本端视图，其余为 v1 兼容。 */
export type Phase =
  | "briefing"
  | "building"
  | "projecting"
  | "build"
  | "polish"
  | "locked"
  | "report";

/** 01 §7 结局 */
export type Ending =
  | "bankrupt"
  | "eco_paradise"
  | "gridlock"
  | "ghost_town"
  | "thriving"
  | "ordinary";

/** 02 §2.1 文字来源：AI 生成或模板降级 */
export type TextSource = "ai" | "template";

/** 02 §2.1 公共文字 */
export interface TextPayload {
  text: string;
  source: TextSource;
}

/** 02 §2.2 */
export interface ParcelConstraints {
  height_limit_m: number;
  green_line_m: number;
  buildable_ratio: number;
  briefing: TextPayload;
}

/** 02 §2.2；v1.1 真实片区字段可选（随机沙盒模式不带，11 §7） */
export interface Parcel {
  size: number;
  cell_size_m: number;
  terrain: Terrain[][];
  inherited_road: Cell[];
  constraints: ParcelConstraints;
  seed: number;
  parcel_id?: string;
  district_name?: string;
  data_version?: string;
  crs?: string;
  origin?: [number, number] | null;
  bbox?: number[] | null;
  buildings_url?: string | null;
  network_url?: string | null;
}

/** 02 §2.3：仅 util_bridge 携带 */
export type BridgeOrientation = "horizontal" | "vertical";

/** 02 §2.3：渲染只信 cells，anchor 用于操作定位 */
export interface Tile {
  id: string;
  type: TileType;
  anchor: Cell;
  cells: Cell[];
  orientation?: BridgeOrientation | null;
  built_at_year: number;
  upkeep: number;
}

/** 02 §3.3 放置请求；桥必须带 orientation，普通区块不允许带 */
export interface PlaceRequest {
  type: TileType;
  anchor: Cell;
  orientation?: BridgeOrientation;
}

/** 01 §4 的 14 指标 */
export interface MetricValues {
  funds: number;
  population: number;
  jobs: number;
  job_res_ratio: number;
  land_price_index: number;
  green_ratio: number;
  avg_commute: number;
  congestion: number;
  pollution: number;
  happiness: number;
  tax_income: number;
  upkeep: number;
  coverage_edu: number;
  coverage_med: number;
}

export type MetricKey = keyof MetricValues;

/** 02 §2.4 */
export interface Metrics extends MetricValues {
  at_year: number;
  at_phase: Phase;
}

/** 02 §2.4：delta 只含发生变化的字段 */
export interface MetricsDiff {
  at_year: number;
  delta: Partial<MetricValues>;
  after?: Metrics;
}

/** 02 §1 错误码（共 7 个） */
export type ErrorCode =
  | "invalid_placement"
  | "invalid_phase"
  | "insufficient_funds"
  | "session_not_found"
  | "cell_occupied"
  | "invalid_payload"
  | "internal_error";

/** 02 §1 错误信封 */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode | (string & {});
    message: string;
    details?: Record<string, unknown>;
  };
}

/** 02 §2.5 */
export interface ProjectionYear {
  year: number;
  metrics: Metrics;
  events: string[];
  source: TextSource;
}

export interface Scores {
  population: number;
  balance: number;
  green: number;
  traffic: number;
  happiness: number;
}

/** 02 §2.5 结构化报告（五维点评字段固定） */
export interface Report {
  overview: string;
  dimensions: Record<keyof Scores, string>;
  ending_story: string;
  source: TextSource;
}

/** 02 §3.1 响应 */
export interface SessionCreated {
  session_id: string;
  parcel: Parcel;
  phase: Phase;
  time_left_sec: number;
  funds: number;
}

/** 02 §2.5 / §3.2 完整会话（刷新、断线恢复用） */
export interface SessionState {
  session_id: string;
  phase: Phase;
  time_left_sec: number;
  parcel: Parcel;
  tiles: Tile[];
  metrics: Metrics;
  placements_count: number;
  projection: ProjectionYear[];
  projection_published_year: number;
  scores: Scores | null;
  ending: Ending | null;
  report: Report | null;
  city_name: string | null;
  city_name_source: TextSource | null;
}

/** 02 §3.3 / §3.4 响应 */
export interface PlaceResult {
  tile: Tile;
  metrics: Metrics;
  metrics_diff: MetricsDiff;
  funds_after: number;
}
export type RemoveResult = PlaceResult;

/** 02 §3.5 响应 */
export interface AdvanceResult {
  phase: Phase;
  time_left_sec: number;
}

/** 02 §3.6 响应 */
export interface FinalizeResult {
  phase: Phase;
  projection: ProjectionYear[];
  ending: Ending;
  scores: Scores;
  report: Report;
  city_name: string;
  city_name_source: TextSource;
}

/** 02 §4 SSE 事件 data 形状 */
export interface SseEventMap {
  tick: MetricsDiff;
  phase_change: AdvanceResult;
  news: {
    headline: string;
    body: string;
    severity: "info" | "warning" | "alert";
    at_year: number;
    source: TextSource;
  };
  citizen: {
    persona: string;
    text: string;
    sentiment: "angry" | "happy" | "neutral";
    topic: "commute" | "edu" | "med" | "green" | "price" | "pollution";
    source: TextSource;
  };
  mentor: {
    comment: string;
    theory_refs: (
      | "tod"
      | "life_circle_15"
      | "jobs_housing_balance"
      | "green_network"
      | "road_hierarchy"
    )[];
    severity: "suggestion" | "warning";
    top_issues: string[];
    source: TextSource;
  };
  projection_step: {
    year: number;
    metrics: Metrics;
    events: string[];
    source: TextSource;
  };
  report_ready: { report: Report; city_name: string; source: TextSource };
  error: { code: string; message: string };
}

export type SseEventName = keyof SseEventMap;
