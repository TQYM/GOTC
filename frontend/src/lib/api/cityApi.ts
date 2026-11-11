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

/** C:S 风格实时模拟快照（后端 `sim_tick` / `speed_change` 事件）。 */
export interface BudgetView {
  funds: number;
  day_income: number;
  day_expenses: number;
  debt: number;
  tax_rates: Record<string, number>;
  income_by_service: Record<string, number>;
  expenses_by_service: Record<string, number>;
}

export interface CitizenView {
  population: number;
  agents: number;
  scale: number;
  avg_age: number;
  avg_happiness: number;
  avg_commute: number;
  employment_rate: number;
  education_dist: Record<string, number>;
  age_dist: Record<string, number>;
}

export interface DistrictView {
  did: number;
  name: string;
  tiles: string[];
  policies: string[];
}

export interface DistrictResult {
  seq: number;
  op_type: string;
}

export interface TransitLineView {
  lid: number;
  name: string;
  kind: "bus" | "metro";
  stops: string[];
  color: string;
  price: number;
  passengers: number;
  stops_count: number;
}

export interface PolicyView {
  key: string;
  label: string;
  hint: string;
  enabled: boolean;
}

export interface MilestoneView {
  tier: number;
  population: number;
  label: string;
  unlocks: string[];
  next: { tier: number; population: number; label: string; unlocks: string[] } | null;
  progress: number;
}

export interface YearPoint {
  year: number;
  population: number;
  jobs: number;
  funds: number;
  happiness: number;
  congestion: number;
  pollution: number;
  avg_commute: number;
  tax_income: number;
  upkeep: number;
}

export interface WeatherView {
  season: string;
  season_label: string;
  kind: string;
  label: string;
  temperature: number;
  cloud: number;
  rain: number;
  fog: number;
}

export interface DisasterView {
  kind: string;
  label: string;
  tile_id: string | null;
  destroyed: boolean;
  happiness: number;
}

export interface TransitResult {
  line: TransitLineView;
  view: SimTickEvent;
}

export interface SimTickEvent {
  frame: number;
  year: number;
  speed: 0 | 1 | 2 | 3;
  paused: boolean;
  hour: number;
  demand: { residential: number; commercial: number; workplace: number };
  builds_total: number;
  citizens?: CitizenView | null;
  districts?: DistrictView[];
  transit?: TransitLineView[];
  history?: YearPoint[];
  milestone?: MilestoneView | null;
  policies?: PolicyView[];
  weather?: WeatherView | null;
  disaster?: DisasterView | null;
  transit_coverage?: number;
  budget: BudgetView | null;
  metrics: Metrics | null;
}

export interface TaxResult {
  service: string;
  rate: number;
  view: SimTickEvent;
}

export interface LoanResult {
  principal: number;
  remaining: number;
  monthly_payment: number;
  months: number;
  rate_bp: number;
  view: SimTickEvent;
}

export interface StreamEventMap {
  sim_tick: SimTickEvent;
  speed_change: SimTickEvent;
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
  /** 批量划区：C:S 的拖拽刷子，一次铺 rows×cols 片 */
  zone?(
    id: string,
    input: { type: TileType; anchor: [number, number]; rows: number; cols: number },
  ): Promise<OperationResult>;
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
  /** 设置模拟速度档：0 暂停 / 1 1x / 2 2x / 3 3x（实际 4x）。 */
  setSpeed?(id: string, speed: 0 | 1 | 2 | 3): Promise<SimTickEvent>;
  setTaxRate?(id: string, service: string, rate: number): Promise<TaxResult>;
  takeLoan?(id: string, amount: number, months?: number, rateBp?: number): Promise<LoanResult>;
  setCityPolicy?(id: string, policy: string, enabled: boolean): Promise<OperationResult>;
  createDistrict?(id: string, name: string, anchor: [number, number], rows: number, cols: number): Promise<DistrictResult>;
  setDistrictPolicy?(id: string, did: number, policy: string, enabled: boolean): Promise<{ district: DistrictView }>;
  setHistorical?(id: string, tileId: string, historical: boolean): Promise<unknown>;
  renameTile?(id: string, tileId: string, name: string | null): Promise<unknown>;
  relocateTile?(id: string, tileId: string, anchor: [number, number]): Promise<unknown>;
  createTransitLine?(id: string, input: { name: string; kind: "bus" | "metro"; stops: string[]; color?: string }): Promise<TransitResult>;
  addTransitStop?(id: string, lid: number, tileId: string): Promise<TransitResult>;
  setTransitPrice?(id: string, lid: number, price: number): Promise<TransitResult>;
  deleteTransitLine?(id: string, lid: number): Promise<{ deleted: number }>;
  subscribe(id: string, handlers: StreamHandlers): () => void;
}

export class UnsupportedError extends Error {
  constructor(what: string) {
    super(`${what}：当前后端版本暂不支持`);
    this.name = "UnsupportedError";
  }
}
