import { describe, expect, it } from "vitest";
import { applyOperation, cityReducer, initialCityStore, type CityStore } from "../lib/store";
import { makeOperation, makeReport, makeState, metrics } from "./fixtures";

function storeWithState(): CityStore {
  return { ...initialCityStore, state: makeState() };
}

describe("saves v2 reducer", () => {
  it("按 seq 幂等，自端响应与广播不重复生效", () => {
    const operation = makeOperation({ metrics: { ...metrics, funds: 4_000_000 } });
    const once = applyOperation(storeWithState(), operation, false);
    expect(once.state?.last_seq).toBe(1);
    expect(once.state?.metrics.funds).toBe(4_000_000);
    const twice = cityReducer(once, { type: "sse", eventId: 1, event: "op_applied", data: operation, remote: false });
    expect(twice.state?.last_seq).toBe(1);
    expect(twice.feed).toHaveLength(0);
    expect(twice.lastEventId).toBe(1);
  });

  it("他端操作产生系统条和300ms场景脉冲数据", () => {
    const next = cityReducer(storeWithState(), {
      type: "sse", eventId: 4, event: "op_applied", data: makeOperation(), remote: true,
    });
    expect(next.pulse).toEqual({ seq: 1, anchor: [0, 1] });
    expect(next.feed[0].title).toBe("另一端已同步");
  });

  it("op 跳号要求恢复，snapshot 清除恢复标记", () => {
    const gap = applyOperation(storeWithState(), makeOperation({ seq: 3 }), true);
    expect(gap.needsRecovery).toBe(true);
    const recovered = cityReducer(gap, { type: "snapshot", state: makeState({ last_seq: 3 }) });
    expect(recovered.needsRecovery).toBe(false);
    expect(recovered.state?.last_seq).toBe(3);
  });

  it("redevelop 同步释放地形并保留完整资产集合", () => {
    const result = makeOperation({
      op_type: "redevelop", redeveloped_asset_ids: ["osm-way-1"],
      redevelopment: {
        asset_id: "osm-way-1", cells: [[0, 0]], demolition_cost: 100,
        population_removed: 10, jobs_removed: 0, happiness_delta: -5, penalty_until_year: 4,
      },
    });
    const next = applyOperation(storeWithState(), result, false);
    expect(next.state?.parcel.terrain[0][0]).toBe("flat");
    expect(next.state?.redeveloped_asset_ids).toEqual(["osm-way-1"]);
  });

  it("他端 start 的轻量 phase_change 同步解除 briefing", () => {
    const briefing = { ...initialCityStore, state: makeState({ phase: "briefing" }) };
    const next = cityReducer(briefing, {
      type: "sse", eventId: 1, event: "phase_change",
      data: { phase: "building", city_year: 1 }, remote: true,
    });
    expect(next.state?.phase).toBe("building");
    expect(next.state?.metrics.at_phase).toBe("building");
  });

  it("报告 AI 更新替换同 ID，城市年份与阶段不变", () => {
    const initial = storeWithState();
    const ai = makeReport({ report: { ...makeReport().report, overview: "AI 更新", source: "ai" } });
    const next = cityReducer(initial, { type: "report", report: ai });
    expect(next.latestReport?.report.overview).toBe("AI 更新");
    expect(next.state).toBe(initial.state);
    expect(next.state?.phase).toBe("building");
  });
});
