/** 前端内部城市接口；真实默认实现为 saves v2，v1/mock 仅保留开发兼容。 */
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
import type {
  OperationResult,
  PhaseV2,
  ReportResult,
  SharedPhase,
} from "@/lib/contractV2";

export type GamePhase = PhaseV2;

export function toGamePhase(p: Phase | PhaseV2): GamePhase {
  switch (p) {
    case "briefing": return "briefing";
    case "build": case "polish": case "building": return "building";
    case "locked": case "projecting": return "projecting";
    case "report": return "report";
  }
}

export interface CitySnapshot {
  id: string;
  name?: string;
  parcel: Parcel;
  tiles: Tile[];
  redevelopedAssetIds: string[];
  metrics: Metrics;
  phase: GamePhase;
  cityYear: number;
  lastSeq: number;
  projection: ProjectionYear[];
  projectionPublishedYear: number;
  projectionId?: string;
  projectionBaseYear?: number;
  projectionBaseSeq?: number;
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

export interface CreateCityInput {
  name?: string;
  parcelId?: "beijing_cbd" | "beijing_core" | "sandbox";
  seed?: number;
}

export interface Capabilities {
  advanceYear: boolean;
  project: boolean;
  report: boolean;
  projectLocksCity: boolean;
  redevelop?: boolean;
  reportHistory?: boolean;
  mentor?: boolean;
}

export interface StreamEventMap {
  tick: SseEventMap["tick"];
  phase_change: {
    phase: Phase | PhaseV2;
    city_year?: number;
    time_left_sec?: number;
  };
  city_year: {
    city_year: number;
    metrics_diff?: MetricsDiff;
    events?: string[];
  };
  snapshot: CitySnapshot;
  op_applied: OperationResult;
  news: SseEventMap["news"];
  citizen: SseEventMap["citizen"];
  mentor: SseEventMap["mentor"];
  projection_step: SseEventMap["projection_step"];
  report_ready: SseEventMap["report_ready"] | ReportResult;
  error: SseEventMap["error"];
}

export type StreamEvent = {
  [K in keyof StreamEventMap]: {
    id: number | null;
    event: K;
    data: StreamEventMap[K];
  };
}[keyof StreamEventMap];

export type ConnState = "connecting" | "open" | "down";
export interface StreamHandlers {
  onEvent: (e: StreamEvent) => void;
  onConn: (s: ConnState, downSinceMs: number | null) => void;
}

export interface CityApi {
  readonly kind: "v2" | "v1" | "mock";
  readonly capabilities: Capabilities;
  create(input?: number | CreateCityInput): Promise<{ id: string }>;
  load(id: string): Promise<CitySnapshot>;
  startPlanning(id: string): Promise<{ phase: SharedPhase; snapshot?: CitySnapshot }>;
  place(id: string, input: PlaceInput): Promise<PlaceResult>;
  remove(id: string, tileId: string): Promise<PlaceResult>;
  redevelop?(id: string, anchor: Cell): Promise<OperationResult>;
  advanceYear(id: string): Promise<{
    cityYear: number;
    metrics: Metrics;
    phase: SharedPhase;
    operation?: OperationResult;
  }>;
  project(id: string): Promise<{
    phase: GamePhase;
    projection: ProjectionYear[];
    projectionId?: string;
    baseYear?: number;
    baseSeq?: number;
    final?: FinalizeResult;
  }>;
  report(id: string): Promise<{
    phase: GamePhase;
    scores: Scores;
    ending: Ending;
    report: Report;
    cityName: string | null;
    result?: ReportResult;
  }>;
  reports?(id: string): Promise<ReportResult[]>;
  mentor?(id: string): Promise<void>;
  /** v1 兼容；v2 只切本端视图，不发 REST。 */
  backToBuilding(id: string): Promise<{ phase: GamePhase }>;
  subscribe(id: string, handlers: StreamHandlers): () => void;
}

export class UnsupportedError extends Error {
  constructor(what: string) {
    super(`${what}：当前后端版本暂不支持`);
    this.name = "UnsupportedError";
  }
}
