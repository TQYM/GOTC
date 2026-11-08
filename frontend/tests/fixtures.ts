import type { Metrics, OperationResult, ProjectionResult, ReportResult, SaveState } from "../lib/types";

export const metrics: Metrics = {
  at_year: 1, at_phase: "building", funds: 5_000_000, population: 100, jobs: 200,
  job_res_ratio: 2, land_price_index: 100, green_ratio: .1, avg_commute: 25,
  congestion: 1.1, pollution: 10, happiness: 70, tax_income: 220_000, upkeep: 10_000,
  coverage_edu: .5, coverage_med: .4,
};

export function makeState(overrides: Partial<SaveState> = {}): SaveState {
  return {
    save_id: "sav_test", city_code: "ABCD1234", name: "测试城市",
    parcel: {
      parcel_id: "beijing_cbd", district_name: "测试 CBD", size: 2, cell_size_m: 50,
      crs: "EPSG:32650", origin: [0, 0], bbox: [116, 39, 117, 40],
      terrain: [["occupied", "flat"], ["river", "forest"]],
      inherited_road: [],
      constraints: {
        height_limit_m: 150, green_line_m: 50, buildable_ratio: 0.7,
        briefing: { text: "测试简报", source: "template" },
      },
      seed: 1,
      buildings_url: "/static/parcels/beijing_cbd/buildings.json",
      network_url: "/static/parcels/beijing_cbd/network.json", data_version: "osm-test",
    },
    tiles: [], redeveloped_asset_ids: [], metrics, city_year: 1, phase: "building", last_seq: 0,
    ...overrides,
  };
}

export function makeOperation(overrides: Partial<OperationResult> = {}): OperationResult {
  return {
    seq: 1, op_type: "place", client_op_id: "web-1", payload: { anchor: [0, 1] },
    tile: null, tiles: [], redeveloped_asset_ids: [], metrics,
    metrics_diff: { at_year: 1, delta: {}, after: metrics }, funds_after: 5_000_000,
    city_year: 1, annual_events: [], redevelopment: null, ...overrides,
  };
}

export function makeReport(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    report_id: "rpt_1", created_at: "2026-11-07T08:00:00Z", base_year: 1, base_seq: 1,
    scores: { population: 60, balance: 70, green: 50, traffic: 65, happiness: 72 },
    ending: "ordinary",
    report: {
      overview: "城市总体稳健。", dimensions: {
        population: "人口稳定", balance: "财政稳定", green: "绿化可提升", traffic: "通勤稳定", happiness: "幸福稳定",
      }, ending_story: "下一年的更新仍由你决定。", source: "template",
    },
    city_name: "测试城市", city_name_source: "template", ...overrides,
  };
}

export function makeProjection(): ProjectionResult {
  return {
    projection_id: "prj_1", base_year: 1, base_seq: 1,
    projection: [2, 3].map((year) => ({
      year, metrics: { ...metrics, at_year: year, population: 100 + year }, events: [], source: "template",
    })),
  };
}
