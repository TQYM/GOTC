export type Phase = "briefing" | "building" | "projecting" | "report";
export type Terrain =
  | "flat" | "hill" | "river" | "bank" | "forest" | "road_inherited" | "occupied";
export type TileType =
  | "res_low" | "res_mid" | "res_high" | "com_shop" | "com_cbd"
  | "ind_light" | "ind_heavy" | "green_park" | "green_plaza"
  | "edu_school" | "med_clinic" | "trans_metro" | "trans_road" | "util_bridge";
export type Tool = "inspect" | "place" | "remove" | "redevelop";
export type Anchor = [number, number];
export type Source = "ai" | "template";

export interface Parcel {
  parcel_id: "beijing_cbd" | "sandbox";
  district_name: string;
  size: number;
  cell_size_m: number;
  crs: string;
  origin: [number, number] | null;
  bbox: [number, number, number, number] | null;
  terrain: Terrain[][];
  constraints: { briefing?: { text: string; source: Source }; [key: string]: unknown };
  seed: number;
  buildings_url: string | null;
  network_url: string | null;
  data_version?: string;
}

export interface Metrics {
  at_year: number;
  at_phase: Phase;
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

export interface Tile {
  id: string;
  type: TileType;
  anchor: Anchor;
  cells: Anchor[];
  orientation: "horizontal" | "vertical" | null;
  built_at_year: number;
  upkeep: number;
}

export interface SaveState {
  save_id: string;
  city_code: string;
  name: string;
  parcel: Parcel;
  tiles: Tile[];
  redeveloped_asset_ids: string[];
  metrics: Metrics;
  city_year: number;
  phase: "briefing" | "building";
  last_seq: number;
}

export interface MetricsDiff {
  at_year: number;
  delta: Record<string, unknown>;
  after: Metrics;
}

export interface RedevelopmentResult {
  asset_id: string;
  cells: Anchor[];
  demolition_cost: number;
  population_removed: number;
  jobs_removed: number;
  happiness_delta: number;
  penalty_until_year: number;
}

export interface OperationResult {
  seq: number;
  op_type: "place" | "remove" | "redevelop" | "advance";
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

export interface ProjectionYear {
  year: number;
  metrics: Metrics;
  events: string[];
  source: Source;
}

export interface ProjectionResult {
  projection_id: string;
  base_year: number;
  base_seq: number;
  projection: ProjectionYear[];
}

export interface Scores {
  population: number;
  balance: number;
  green: number;
  traffic: number;
  happiness: number;
}

export interface Report {
  overview: string;
  dimensions: Record<keyof Scores, string>;
  ending_story: string;
  source: Source;
}

export interface ReportResult {
  report_id: string;
  created_at: string;
  base_year: number;
  base_seq: number;
  scores: Scores;
  ending: "bankrupt" | "eco_paradise" | "gridlock" | "ghost_town" | "thriving" | "ordinary";
  report: Report;
  city_name: string;
  city_name_source: Source;
}

export interface ExistingAsset {
  asset_id: string;
  category: "residential" | "workplace" | "industrial" | "civic";
  height_m: number;
  levels: number;
  footprint: [number, number][];
  cells: Anchor[];
  base_area_m2: number;
  population: number;
  jobs: number;
  demolition_cost: number;
  upkeep: number;
  height_source: string;
  name?: string | null;
}

export interface BuildingsFile {
  parcel_id: string;
  data_version?: string;
  chunks: Record<string, ExistingAsset[]>;
}

export interface NetworkFeature {
  kind: string;
  level?: string;
  path: [number, number][];
  name?: string | null;
}

export interface NetworkFile {
  parcel_id: string;
  data_version?: string;
  features: NetworkFeature[];
}

export interface FeedItem {
  key: string;
  kind: "news" | "citizen" | "mentor" | "system";
  title: string;
  text: string;
  source?: Source;
}
