export type {
  BridgeOrientation,
  Cell as Anchor,
  Metrics,
  MetricsDiff,
  Parcel,
  ProjectionYear,
  Report,
  Scores,
  Terrain,
  TextSource as Source,
  Tile,
  TileType,
} from "../src/lib/contract";
export type { Phase } from "../src/lib/contract";
export type {
  OperationResult,
  ProjectionResult,
  RedevelopmentResult,
  ReportResult,
  SaveState,
} from "../src/lib/contractV2";

export type Tool = "inspect" | "place" | "remove" | "redevelop";

export interface ExistingAsset {
  asset_id: string;
  category: "residential" | "workplace" | "industrial" | "civic";
  height_m: number;
  levels: number;
  footprint: [number, number][];
  cells: [number, number][];
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
  feature_id: string;
  kind: string;
  highway?: string | null;
  /** Legacy upstream packages used level; canonical saves v2 uses highway. */
  level?: string | null;
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
  source?: "ai" | "template";
}
