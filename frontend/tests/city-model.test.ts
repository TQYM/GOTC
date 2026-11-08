import { describe, expect, it } from "vitest";
import {
  buildCellIndex,
  buildingColor,
  buildingInfo,
  dedupeLandmarks,
  isChunkedBuildingsFile,
  isFullBuildingsFile,
  landmarkOf,
  mapPointToCell,
  normalizeBuildings,
  serviceSummary,
  toBuildingTable,
  TOON_LANDMARK_COLORS,
  type FullBuildingRecord,
} from "../lib/cityModel";
import type { BuildingsFile, ExistingAsset } from "../lib/types";

function full(
  over: Partial<FullBuildingRecord> & { id: string },
): FullBuildingRecord {
  return {
    name: null,
    kind: "generated",
    category: "res_mid",
    height_m: 20,
    footprint: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ],
    cells: [[0, 0]],
    center: [50, 50],
    ...over,
  };
}

function asset(id: string, over: Partial<ExistingAsset> = {}): ExistingAsset {
  return {
    asset_id: id,
    category: "workplace",
    height_m: 30,
    levels: 10,
    footprint: [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ],
    cells: [[0, 0]],
    base_area_m2: 400,
    population: 0,
    jobs: 10,
    demolition_cost: 1,
    upkeep: 1,
    height_source: "osm",
    ...over,
  };
}

describe("normalizeBuildings", () => {
  it("detects both package formats", () => {
    expect(isFullBuildingsFile({ buildings: [] })).toBe(true);
    expect(isChunkedBuildingsFile({ parcel_id: "x", chunks: {} })).toBe(true);
    expect(isFullBuildingsFile({ chunks: {} })).toBe(false);
    expect(normalizeBuildings({ nope: 1 })).toEqual([]);
    expect(normalizeBuildings(null)).toEqual([]);
  });

  it("maps beijing_full records and strips the closing ring point", () => {
    const [b] = normalizeBuildings({
      buildings: [
        full({
          id: "w1",
          name: "某小学",
          kind: "functional",
          category: "school",
        }),
      ],
    });
    expect(b).toMatchObject({
      id: "w1",
      kind: "functional",
      category: "school",
      height: 20,
      center: [50, 50],
    });
    expect(b.footprint).toHaveLength(4);
  });

  it("maps beijing_cbd chunks, filters redeveloped assets and recognises landmarks by name", () => {
    const file: BuildingsFile = {
      parcel_id: "beijing_cbd",
      chunks: {
        "0:0": [asset("a"), asset("zun", { name: "中国尊", height_m: 528 })],
        "0:1": [asset("b"), asset("cctv", { name: "中央电视台总部大楼" })],
      },
    };
    const list = normalizeBuildings(file, ["b"]);
    expect(list.map((b) => b.id)).toEqual(["a", "zun", "cctv"]);
    expect(list[0]).toMatchObject({
      kind: "existing",
      category: "workplace",
      center: [10, 10],
    });
    expect(list[1]).toMatchObject({
      kind: "landmark",
      landmark: "zun",
      height: 528,
    });
    expect(buildingColor(list[1])).toBe(TOON_LANDMARK_COLORS.zun);
    expect(buildingColor(list[2])).toBe(TOON_LANDMARK_COLORS.cctv);
  });

  it("falls back to levels when height is missing and drops degenerate footprints", () => {
    const file: BuildingsFile = {
      parcel_id: "x",
      chunks: {
        "0:0": [
          asset("h", { height_m: 0, levels: 5 }),
          asset("bad", {
            footprint: [
              [0, 0],
              [1, 1],
            ],
          }),
        ],
      },
    };
    const list = normalizeBuildings(file);
    expect(list).toHaveLength(1);
    expect(list[0].height).toBeCloseTo(16);
  });
});

describe("dedupeLandmarks", () => {
  it("keeps one 故宫 (largest footprint) and merges the cells of its duplicates", () => {
    const small: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const big: [number, number][] = [
      [0, 0],
      [900, 0],
      [900, 900],
      [0, 900],
    ];
    const list = normalizeBuildings({
      buildings: [
        full({
          id: "r1",
          name: "故宫",
          kind: "landmark",
          landmark: "gugong",
          footprint: small,
          cells: [[1, 1]],
        }),
        full({
          id: "r1",
          name: "故宫",
          kind: "landmark",
          landmark: "gugong",
          footprint: big,
          cells: [[1, 2]],
        }),
        full({
          id: "r1",
          name: "故宫",
          kind: "landmark",
          landmark: "gugong",
          footprint: small,
          cells: [[1, 1]],
        }),
        full({ id: "g", name: "1号楼" }),
        full({ id: "g2", name: "1号楼" }),
      ],
    });
    const gugong = list.filter((b) => b.landmark === "gugong");
    expect(gugong).toHaveLength(1);
    expect(gugong[0].footprint).toEqual(big);
    expect(gugong[0].cells).toEqual([
      [1, 1],
      [1, 2],
    ]);
    // 部件破碎（外接矩形远大于最大部件）时改用整体外接矩形
    const walls = normalizeBuildings({
      buildings: [
        full({
          id: "w",
          name: "故宫",
          kind: "landmark",
          landmark: "gugong",
          footprint: [
            [0, 0],
            [100, 0],
            [100, 10],
            [0, 10],
          ],
          cells: [[0, 0]],
        }),
        full({
          id: "w",
          name: "故宫",
          kind: "landmark",
          landmark: "gugong",
          footprint: [
            [0, 900],
            [100, 900],
            [100, 1000],
            [0, 1000],
          ],
          cells: [[4, 0]],
        }),
      ],
    });
    expect(walls).toHaveLength(1);
    expect(walls[0].footprint).toEqual([
      [0, 0],
      [100, 0],
      [100, 1000],
      [0, 1000],
    ]);
    expect(walls[0].center).toEqual([50, 500]);
    // 普通建筑同名不去重
    expect(list.filter((b) => b.name === "1号楼")).toHaveLength(2);
    expect(dedupeLandmarks([])).toEqual([]);
  });

  it("recognises landmark keys and names", () => {
    expect(landmarkOf("niaochao", null)).toBe("niaochao");
    expect(landmarkOf("unknown", "国家游泳中心（水立方）")).toBe("watercube");
    expect(landmarkOf(undefined, "国贸三期")).toBeNull();
  });
});

describe("cell picking index", () => {
  it("maps every cell to the most important building", () => {
    const list = normalizeBuildings({
      buildings: [
        full({
          id: "low",
          height_m: 8,
          cells: [
            [0, 0],
            [0, 1],
          ],
        }),
        full({ id: "tall", height_m: 80, cells: [[0, 1]] }),
        full({
          id: "school",
          kind: "functional",
          category: "school",
          height_m: 12,
          cells: [[1, 1]],
        }),
        full({
          id: "res",
          height_m: 99,
          cells: [
            [1, 1],
            [9, 9],
          ],
        }),
      ],
    });
    const idx = buildCellIndex(list, 2, 2);
    expect(Array.from(idx)).toEqual([0, 1, -1, 2]);
    expect(mapPointToCell(150, 50, 2, 2, 100)).toEqual([0, 1]);
    expect(mapPointToCell(150, 250, 2, 2, 100)).toBeNull();
    expect(mapPointToCell(-1, 0, 2, 2, 100)).toBeNull();
  });
});

describe("building table + service summary", () => {
  it("round-trips info and counts homes / peers inside the service radius", () => {
    const list = normalizeBuildings({
      buildings: [
        full({
          id: "s1",
          name: "实验小学",
          kind: "functional",
          category: "school",
          center: [0, 0],
        }),
        full({
          id: "s2",
          name: "二小",
          kind: "functional",
          category: "school",
          center: [500, 0],
        }),
        full({ id: "h1", category: "res_low", center: [300, 300] }),
        full({ id: "h2", category: "res_high", center: [900, 900] }),
        full({ id: "shop", category: "shop", center: [10, 10] }),
        full({
          id: "hosp",
          kind: "functional",
          category: "hospital",
          center: [0, 2000],
        }),
      ],
    });
    const t = toBuildingTable(list);
    expect(buildingInfo(t, 0)).toMatchObject({
      id: "s1",
      name: "实验小学",
      kind: "functional",
      category: "school",
      footprintM2: 10000,
    });
    expect(buildingInfo(t, 99)).toBeNull();
    expect(serviceSummary(t, 0)).toEqual({
      kind: "school",
      radius: 1000,
      homes: 1,
      peers: 1,
    });
    expect(serviceSummary(t, 5)).toMatchObject({
      kind: "hospital",
      radius: 3000,
      homes: 2,
      peers: 0,
    });
    expect(serviceSummary(t, 2)).toBeNull();
  });
});
