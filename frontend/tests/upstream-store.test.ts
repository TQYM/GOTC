import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CityApi, CitySnapshot } from "@/lib/api";
import type { SaveState } from "@/lib/contractV2";
import { useGame } from "@/store/game";
import { makeOperation, makeProjection, makeReport, makeState, metrics } from "./fixtures";

function snapshot(state: SaveState): CitySnapshot {
  return {
    id: state.city_code,
    name: state.name,
    parcel: state.parcel,
    tiles: state.tiles,
    redevelopedAssetIds: state.redeveloped_asset_ids,
    metrics: state.metrics,
    phase: state.phase,
    cityYear: state.city_year,
    lastSeq: state.last_seq,
    projection: [],
    projectionPublishedYear: 0,
    scores: null,
    ending: null,
    report: null,
    cityName: state.name,
  };
}

function fakeApi(state: SaveState) {
  return {
    kind: "v2",
    capabilities: {
      advanceYear: true, project: true, report: true, projectLocksCity: false,
      redevelop: true, reportHistory: true, mentor: true,
    },
    load: vi.fn().mockResolvedValue(snapshot(state)),
    project: vi.fn().mockResolvedValue({
      phase: "projecting",
      projection: makeProjection().projection,
      projectionId: "prj_1",
      baseYear: 1,
      baseSeq: 1,
    }),
    report: vi.fn().mockResolvedValue({
      phase: "report",
      scores: makeReport().scores,
      ending: makeReport().ending,
      report: makeReport().report,
      cityName: makeReport().city_name,
      result: makeReport(),
    }),
    backToBuilding: vi.fn().mockResolvedValue({ phase: "building" }),
  } as unknown as CityApi;
}

describe("上游 store 的 saves v2 状态语义", () => {
  beforeEach(() => {
    useGame.setState(useGame.getInitialState(), true);
  });

  it("SSE event id 与 op seq 独立，重复 op 不重复追加年度事件", async () => {
    await useGame.getState().init(fakeApi(makeState()), "ABCD1234");
    const operation = makeOperation({
      annual_events: ["年度结算"],
      metrics: { ...metrics, funds: 4_000_000 },
    });
    useGame.getState().applyEvent({ id: 1_700_000_000, event: "op_applied", data: operation });
    expect(useGame.getState().lastSeq).toBe(1);
    expect(useGame.getState().lastEventId).toBe(1_700_000_000);
    expect(useGame.getState().feed).toHaveLength(1);
    useGame.getState().applyEvent({ id: 1_700_000_001, event: "op_applied", data: operation });
    expect(useGame.getState().feed).toHaveLength(1);
    expect(useGame.getState().metrics?.funds).toBe(4_000_000);
  });

  it("op 跳号不应用不连续结果，而是全量恢复", async () => {
    const recovered = makeState({ last_seq: 3, metrics: { ...metrics, funds: 123 } });
    const api = fakeApi(makeState());
    await useGame.getState().init(api, "ABCD1234");
    vi.mocked(api.load).mockResolvedValue(snapshot(recovered));
    useGame.getState().applyEvent({
      id: 99,
      event: "op_applied",
      data: makeOperation({ seq: 3, metrics: { ...metrics, funds: 999 } }),
    });
    await vi.waitFor(() => expect(useGame.getState().lastSeq).toBe(3));
    expect(useGame.getState().metrics?.funds).toBe(123);
    expect(api.load).toHaveBeenCalledTimes(2);
  });

  it("较慢的旧 snapshot 不回滚新 op，资产 ID 引用保持稳定", async () => {
    await useGame.getState().init(fakeApi(makeState()), "ABCD1234");
    useGame.getState().applyEvent({
      id: 98,
      event: "op_applied",
      data: makeOperation({ metrics: { ...metrics, funds: 999 } }),
    });
    const ids = useGame.getState().redevelopedAssetIds;
    expect(useGame.getState().lastSeq).toBe(1);
    useGame.getState().applySnapshot(snapshot(makeState({
      last_seq: 0,
      metrics: { ...metrics, funds: 123 },
    })));
    expect(useGame.getState().lastSeq).toBe(1);
    expect(useGame.getState().metrics?.funds).toBe(999);
    expect(useGame.getState().redevelopedAssetIds).toBe(ids);
  });

  it("切换城市时不会把上一城市的 seq 和现场带入新存档", async () => {
    await useGame.getState().init(fakeApi(makeState()), "ABCD1234");
    useGame.getState().applyEvent({ id: 1, event: "op_applied", data: makeOperation() });
    const next = makeState({ city_code: "WXYZ5678" });
    const pending = useGame.getState().init(fakeApi(next), "WXYZ5678");
    expect(useGame.getState().lastSeq).toBe(0);
    expect(useGame.getState().tiles).toEqual([]);
    expect(useGame.getState().parcel).toBeNull();
    await pending;
    expect(useGame.getState().id).toBe("WXYZ5678");
  });

  it("redevelop 释放全部资产格并同步 asset_id 集合", async () => {
    await useGame.getState().init(fakeApi(makeState()), "ABCD1234");
    useGame.getState().applyEvent({
      id: 10,
      event: "op_applied",
      data: makeOperation({
        op_type: "redevelop",
        redeveloped_asset_ids: ["osm-way-1"],
        redevelopment: {
          asset_id: "osm-way-1", cells: [[0, 0]], demolition_cost: 100,
          population_removed: 10, jobs_removed: 0, happiness_delta: -5, penalty_until_year: 4,
        },
      }),
    });
    expect(useGame.getState().parcel?.terrain[0][0]).toBe("flat");
    expect(useGame.getState().redevelopedAssetIds).toEqual(["osm-way-1"]);
  });

  it("远端 phase/op 不退出本端推演，v2 返回建设不调用 REST", async () => {
    const api = fakeApi(makeState());
    await useGame.getState().init(api, "ABCD1234");
    await useGame.getState().project();
    expect(useGame.getState().phase).toBe("projecting");
    expect(useGame.getState().sharedPhase).toBe("building");
    expect(useGame.getState().projectionId).toBe("prj_1");
    useGame.getState().applyEvent({ id: 20, event: "phase_change", data: { phase: "building", city_year: 1 } });
    useGame.getState().applyEvent({ id: 21, event: "op_applied", data: makeOperation() });
    expect(useGame.getState().phase).toBe("projecting");
    expect(useGame.getState().lastSeq).toBe(1);
    useGame.getState().applyEvent({
      id: 22, event: "projection_step", data: { ...makeProjection().projection[1], year: 99 },
    });
    expect(useGame.getState().projectionYear).toBe(0);
    useGame.getState().applyEvent({ id: null, event: "projection_step", data: makeProjection().projection[0] });
    expect(useGame.getState().projectionYear).toBe(2);
    await useGame.getState().backToBuilding();
    expect(useGame.getState().phase).toBe("building");
    expect(api.backToBuilding).not.toHaveBeenCalled();
  });

  it("报告是本端视图，异步广播只更新同 ID 报告", async () => {
    await useGame.getState().init(fakeApi(makeState()), "ABCD1234");
    await useGame.getState().makeReport();
    expect(useGame.getState().phase).toBe("report");
    const other = makeReport({ report_id: "rpt_other" });
    useGame.getState().applyEvent({ id: 30, event: "report_ready", data: other });
    expect(useGame.getState().cityReport?.reportId).toBe("rpt_1");
    const updated = makeReport({ report: { ...makeReport().report, overview: "AI 更新", source: "ai" } });
    useGame.getState().applyEvent({ id: 31, event: "report_ready", data: updated });
    expect(useGame.getState().cityReport?.report.overview).toBe("AI 更新");
    useGame.getState().applyEvent({ id: 32, event: "phase_change", data: { phase: "building" } });
    expect(useGame.getState().phase).toBe("report");
  });
});
