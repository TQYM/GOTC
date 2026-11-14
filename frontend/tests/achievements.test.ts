import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  detectNew,
  loadUnlocked,
  saveUnlocked,
  type AchievementContext,
} from "../src/lib/achievements";
import type { Metrics } from "../src/lib/contract";

function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    population: 0,
    jobs: 0,
    job_res_ratio: 0,
    land_price_index: 40,
    green_ratio: 0.1,
    avg_commute: 0,
    congestion: 0,
    pollution: 0,
    happiness: 60,
    tax_income: 0,
    upkeep: 0,
    coverage_edu: 0,
    coverage_med: 0,
    funds: 5_000_000,
    service_coverage: {},
    at_year: 1,
    at_phase: "build",
    ...over,
  } as Metrics;
}

function ctx(over: Partial<AchievementContext> = {}): AchievementContext {
  return {
    metrics: metrics(),
    cityYear: 1,
    buildsTotal: 0,
    districtCount: 0,
    transitCount: 0,
    ...over,
  };
}

describe("成就判定", () => {
  it("空地不触发任何成就", () => {
    expect(detectNew(ctx(), new Set())).toHaveLength(0);
  });

  it("放第一栋楼解锁「第一铲土」", () => {
    const got = detectNew(ctx({ buildsTotal: 1 }), new Set());
    expect(got.map((a) => a.id)).toContain("first-build");
  });

  it("已解锁的不会重复返回", () => {
    const got = detectNew(ctx({ buildsTotal: 1 }), new Set(["first-build"]));
    expect(got.map((a) => a.id)).not.toContain("first-build");
  });

  it("同一次 tick 可返回多个，且按声明序", () => {
    const got = detectNew(
      ctx({
        metrics: metrics({ population: 12_000, happiness: 85 }),
        buildsTotal: 5,
        cityYear: 12,
      }),
      new Set(),
    );
    const ids = got.map((a) => a.id);
    expect(ids).toContain("first-build");
    expect(ids).toContain("pop-1k");
    expect(ids).toContain("pop-10k");
    expect(ids).toContain("happy-80");
    expect(ids).toContain("year-10");
    // 声明序：first-build 在 pop-1k 之前
    expect(ids.indexOf("first-build")).toBeLessThan(ids.indexOf("pop-1k"));
  });

  it("通勤 0 不算「畅通无阻」——那是还没人上班的占位", () => {
    const got = detectNew(ctx({ metrics: metrics({ avg_commute: 0 }) }), new Set());
    expect(got.map((a) => a.id)).not.toContain("commute-20");
    const real = detectNew(ctx({ metrics: metrics({ avg_commute: 18 }) }), new Set());
    expect(real.map((a) => a.id)).toContain("commute-20");
  });

  it("门槛类成就在阈值处触发", () => {
    expect(
      detectNew(ctx({ metrics: metrics({ green_ratio: 0.4 }) }), new Set()).map((a) => a.id),
    ).toContain("green-40");
    expect(
      detectNew(ctx({ metrics: metrics({ green_ratio: 0.39 }) }), new Set()).map((a) => a.id),
    ).not.toContain("green-40");
  });

  it("成就总数与 id 唯一", () => {
    expect(ACHIEVEMENTS.length).toBe(12);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it("localStorage 往返", () => {
    saveUnlocked(new Set(["first-build", "pop-1k"]));
    expect([...loadUnlocked()].sort()).toEqual(["first-build", "pop-1k"]);
  });
});
