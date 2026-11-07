/**
 * 城市接口抽象：前端只依赖这一层，后端从 v1 sessions 迁到 v2 saves（10 §5）时只换适配器。
 *
 * - 阶段统一为不限时 4 态（10 §3）：briefing / building / projecting / report；
 * - 前端不读取任何倒计时字段（`time_left_sec` 已废弃，05 §3.4）；
 * - 城市年份 `city_year`：v1 后端用 metrics.at_year 承载，v2 直接下发。
 */
import type {
  BridgeOrientation,
  Cell,
  Ending,
  FinalizeResult,
  Metrics,
  MetricsDiff,
  Parcel,
  Phase,
  PlaceResult,
  ProjectionYear,
  Report,
  Scores,
  SseEventMap,
  Tile,
  TileType,
} from "@/lib/contract";
import type { PhaseV2 } from "@/lib/contractV2";

export type GamePhase = PhaseV2;

/** v1 五阶段 → 不限时 4 态（build/polish 合并为 building，locked 即推演中） */
export function toGamePhase(p: Phase | PhaseV2): GamePhase {
  switch (p) {
    case "briefing":
      return "briefing";
    case "build":
    case "polish":
    case "building":
      return "building";
    case "locked":
    case "projecting":
      return "projecting";
    case "report":
      return "report";
  }
}

export interface CitySnapshot {
  id: string;
  parcel: Parcel;
  tiles: Tile[];
  metrics: Metrics;
  phase: GamePhase;
  cityYear: number;
  projection: ProjectionYear[];
  projectionPublishedYear: number;
  scores: Scores | null;
  ending: Ending | null;
  report: Report | null;
  cityName: string | null;
}

export interface PlaceInput {
  type: TileType;
  anchor: Cell;
  orientation?: BridgeOrientation;
}

/** 后端是否提供该能力（v1 后端没有手动快进/只读推演/单独报告） */
export interface Capabilities {
  advanceYear: boolean;
  project: boolean;
  report: boolean;
  /** v1 的「推演」= finalize，会锁定本局 */
  projectLocksCity: boolean;
}

/** 推送事件（SSE 或 mock 内部广播），id 为单调序号 */
export type StreamEvent = {
  [K in keyof StreamEventMap]: {
    id: number | null;
    event: K;
    data: StreamEventMap[K];
  };
}[keyof StreamEventMap];

/** v1 事件表 + v2 新增事件（10 §5） */
export interface StreamEventMap extends SseEventMap {
  city_year: {
    city_year: number;
    metrics_diff?: MetricsDiff;
    events?: string[];
  };
}

export type ConnState = "connecting" | "open" | "down";

export interface StreamHandlers {
  onEvent: (e: StreamEvent) => void;
  onConn: (s: ConnState, downSinceMs: number | null) => void;
}

export interface CityApi {
  readonly kind: "v1" | "mock";
  readonly capabilities: Capabilities;
  create(seed?: number): Promise<{ id: string }>;
  load(id: string): Promise<CitySnapshot>;
  /** briefing → building（「开始规划」） */
  startPlanning(id: string): Promise<{ phase: GamePhase }>;
  place(id: string, input: PlaceInput): Promise<PlaceResult>;
  remove(id: string, tileId: string): Promise<PlaceResult>;
  /** 快进一年（10 §3 advance） */
  advanceYear(
    id: string,
  ): Promise<{ cityYear: number; metrics: Metrics; phase: GamePhase }>;
  /** 未来推演 10 年 */
  project(id: string): Promise<{
    phase: GamePhase;
    projection: ProjectionYear[];
    final?: FinalizeResult;
  }>;
  /** 城市诊断报告 */
  report(id: string): Promise<{
    phase: GamePhase;
    scores: Scores;
    ending: Ending;
    report: Report;
    cityName: string | null;
  }>;
  /** 关闭报告 / 结束推演回到建设（v2 语义；v1 不支持） */
  backToBuilding(id: string): Promise<{ phase: GamePhase }>;
  subscribe(id: string, handlers: StreamHandlers): () => void;
}

export class UnsupportedError extends Error {
  constructor(what: string) {
    super(`${what}：当前后端版本暂不支持`);
    this.name = "UnsupportedError";
  }
}
