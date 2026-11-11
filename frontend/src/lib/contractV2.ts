/** saves v2 的现行 02 契约镜像；共享阶段与本端 UI 视图严格分开。 */
import type {
  Cell,
  Ending,
  Metrics,
  MetricsDiff,
  Parcel,
  Report,
  Scores,
  TextSource,
  Tile,
  TileType,
} from "./contract";

export type PhaseV2 = "briefing" | "building" | "projecting" | "report";
export type SharedPhase = "briefing" | "building";
export type CityCode = string;

export interface SaveState {
  save_id: string;
  city_code: CityCode;
  name: string;
  parcel: Parcel;
  tiles: Tile[];
  redeveloped_asset_ids: string[];
  metrics: Metrics;
  city_year: number;
  phase: SharedPhase;
  last_seq: number;
}

export interface RedevelopmentResult {
  asset_id: string;
  cells: Cell[];
  demolition_cost: number;
  population_removed: number;
  jobs_removed: number;
  happiness_delta: number;
  penalty_until_year: number;
}

export interface OperationResult {
  seq: number;
  op_type: "place" | "remove" | "redevelop" | "advance" | "zone";
  client_op_id: string;
  payload: Record<string, unknown>;
  tile: Tile | null;
  tiles: Tile[];
  redeveloped_asset_ids: string[];
  metrics: Metrics;
  metrics_diff: MetricsDiff;
  funds_after: number;
  city_year: number;
  annual_events: string[];
  redevelopment: RedevelopmentResult | null;
}

export interface PlaceInput {
  type: TileType;
  anchor: Cell;
  orientation?: "horizontal" | "vertical";
}

export interface ProjectionResult {
  projection_id: string;
  base_year: number;
  base_seq: number;
  projection: {
    year: number;
    metrics: Metrics;
    events: string[];
    source: TextSource;
  }[];
}

export interface ReportResult {
  report_id: string;
  created_at: string;
  base_year: number;
  base_seq: number;
  scores: Scores;
  ending: Ending;
  report: Report;
  city_name: string;
  city_name_source: TextSource;
}
