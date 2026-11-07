/**
 * 浏览器内 mock 后端（02 §0.2 允许的 mock 开关）：按 10 号文档 v2 的不限时语义运行，
 * 用于离线演示、无后端开发和 v2 交互（快进一年 / 只读推演 / 随时报告）的前端验收。
 *
 * ⚠️ 指标是粗略的演示公式，不是 sim 引擎；数值以真后端为准（铁律：数值只来自确定性引擎）。
 * 状态存 localStorage，刷新后可恢复；事件在内存广播并缓冲最近 200 条（模拟 Last-Event-ID 补发）。
 */
import type {
  Ending,
  Metrics,
  MetricValues,
  MetricsDiff,
  Parcel,
  PlaceResult,
  ProjectionYear,
  Report,
  Scores,
  Tile,
} from "@/lib/contract";
import { TILE_SPECS } from "@/lib/catalog";
import { MOCK_SESSION } from "@/lib/mock";
import { checkPlacement, estimateRefund, occupiedKey } from "@/lib/validate";
import { ApiError } from "./http";
import type {
  CityApi,
  CitySnapshot,
  GamePhase,
  StreamEvent,
  StreamHandlers,
} from "./cityApi";

interface MockCity {
  id: string;
  phase: GamePhase;
  cityYear: number;
  tiles: Tile[];
  metrics: Metrics;
  ops: number;
  nextEventId: number;
  events: StreamEvent[];
  projection: ProjectionYear[];
  /** 推演已推送到的年份（刷新后从这里续播） */
  projectionPublished: number;
  scores: Scores | null;
  ending: Ending | null;
  report: Report | null;
}

const KEY = (id: string) => `city20.mock.${id}`;
const parcel: Parcel = MOCK_SESSION.parcel;
const subscribers = new Map<string, Set<StreamHandlers>>();

/** phase_change 载荷：v1 契约仍要求 time_left_sec 字段，mock 固定填 0，前端从不读取 */
const phaseData = (phase: "build" | "locked" | "report") => ({
  phase,
  time_left_sec: 0,
});

const CAPACITY: Partial<Record<Tile["type"], number>> = {
  res_low: 300,
  res_mid: 900,
  res_high: 2400,
};
const JOBS: Partial<Record<Tile["type"], number>> = {
  com_shop: 80,
  com_cbd: 1200,
  ind_light: 900,
  ind_heavy: 2600,
  edu_school: 60,
  med_clinic: 150,
};
const UPKEEP: Record<Tile["type"], number> = {
  res_low: 8_000,
  res_mid: 12_000,
  res_high: 30_000,
  com_shop: 30_000,
  com_cbd: 150_000,
  ind_light: 100_000,
  ind_heavy: 200_000,
  green_park: 5_000,
  green_plaza: 15_000,
  edu_school: 80_000,
  med_clinic: 120_000,
  trans_metro: 200_000,
  trans_road: 2_000,
  util_bridge: 10_000,
};

function compute(
  tiles: Tile[],
  funds: number,
  year: number,
  phase: GamePhase,
): Metrics {
  const sum = (m: Partial<Record<Tile["type"], number>>) =>
    tiles.reduce((a, t) => a + (m[t.type] ?? 0), 0);
  const count = (pred: (t: Tile) => boolean) => tiles.filter(pred).length;
  const population = sum(CAPACITY);
  const jobs = sum(JOBS);
  const greenCells = tiles
    .filter((t) => TILE_SPECS[t.type].category === "green")
    .reduce((a, t) => a + t.cells.length, 0);
  const builtCells = tiles.reduce((a, t) => a + t.cells.length, 0);
  const green_ratio = builtCells ? +(greenCells / builtCells).toFixed(3) : 0;
  const pollution = +Math.min(
    1,
    count((t) => t.type === "ind_heavy") * 0.12 +
      count((t) => t.type === "ind_light") * 0.05,
  ).toFixed(3);
  const roads =
    count((t) => t.type === "trans_road") +
    count((t) => t.type === "trans_metro") * 8;
  const congestion = population
    ? +Math.min(1.5, population / (4000 + roads * 600)).toFixed(3)
    : 0;
  const avg_commute = population
    ? Math.round(
        18 + congestion * 40 - count((t) => t.type === "trans_metro") * 3,
      )
    : 0;
  const coverage_edu = population
    ? +Math.min(
        1,
        (count((t) => t.type === "edu_school") * 3000) / population,
      ).toFixed(3)
    : 0;
  const coverage_med = population
    ? +Math.min(
        1,
        (count((t) => t.type === "med_clinic") * 5000) / population,
      ).toFixed(3)
    : 0;
  const happiness = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        50 +
          green_ratio * 40 +
          coverage_edu * 10 +
          coverage_med * 8 -
          pollution * 30 -
          congestion * 15,
      ),
    ),
  );
  return {
    at_year: year,
    at_phase:
      phase === "building"
        ? "build"
        : phase === "projecting"
          ? "locked"
          : phase,
    funds,
    population,
    jobs,
    job_res_ratio: population ? +(jobs / population).toFixed(3) : 0,
    land_price_index: +(
      100 +
      green_ratio * 30 +
      count((t) => t.type === "com_cbd") * 6
    ).toFixed(1),
    green_ratio,
    avg_commute,
    congestion,
    pollution,
    happiness,
    tax_income: population * 120 + jobs * 220,
    upkeep: tiles.reduce(
      (a, t) =>
        a + UPKEEP[t.type] * (t.type === "util_bridge" ? t.cells.length : 1),
      0,
    ),
    coverage_edu,
    coverage_med,
  };
}

function diff(before: Metrics, after: Metrics): MetricsDiff {
  const delta: Partial<MetricValues> = {};
  for (const k of Object.keys(after) as (keyof Metrics)[]) {
    if (k === "at_year" || k === "at_phase") continue;
    const d = (after[k] as number) - (before[k] as number);
    if (Math.abs(d) > 1e-9) delta[k] = +d.toFixed(4);
  }
  return { at_year: after.at_year, delta, after };
}

function load(id: string): MockCity {
  const raw =
    typeof localStorage !== "undefined" ? localStorage.getItem(KEY(id)) : null;
  if (!raw) throw new ApiError(404, "session_not_found", "城市不存在");
  return JSON.parse(raw) as MockCity;
}

function save(c: MockCity) {
  try {
    localStorage.setItem(KEY(c.id), JSON.stringify(c));
  } catch {
    /* 存储不可用时仅内存态 */
  }
}

function emit<K extends StreamEvent["event"]>(
  c: MockCity,
  event: K,
  data: Extract<StreamEvent, { event: K }>["data"],
) {
  const e = { id: c.nextEventId++, event, data } as StreamEvent;
  c.events = [...c.events.slice(-199), e];
  save(c);
  for (const h of subscribers.get(c.id) ?? []) h.onEvent(e);
}

function snapshot(c: MockCity): CitySnapshot {
  return {
    id: c.id,
    parcel,
    tiles: c.tiles,
    redevelopedAssetIds: [],
    metrics: c.metrics,
    phase: c.phase,
    cityYear: c.cityYear,
    lastSeq: c.ops,
    projection: c.projection,
    projectionPublishedYear: c.projectionPublished,
    scores: c.scores,
    ending: c.ending,
    report: c.report,
    cityName: c.report ? "演示市" : null,
  };
}

function requireBuilding(c: MockCity) {
  if (c.phase !== "building")
    throw new ApiError(400, "invalid_phase", "当前阶段不允许操作");
}

const NEWS = [
  "新楼盘开工",
  "城市名片初现",
  "商圈人气上升",
  "通勤议题升温",
  "绿地口碑走高",
];
const CITIZEN: Record<string, string> = {
  residential: "终于有地方住了，离地铁再近点就好😊",
  commercial: "楼下开了店，买菜方便多了",
  industrial: "工厂开工了，就是有点担心空气",
  service: "孩子上学/看病都近了，点赞",
  green: "下班能去公园走走，舒服",
  transport: "通勤路好走一些了",
  utility: "桥通了，过河不用绕远",
};

function afterOp(
  c: MockCity,
  before: Metrics,
  tile: Tile,
  verb: "place" | "remove",
) {
  c.ops++;
  emit(c, "tick", diff(before, c.metrics));
  if (verb === "place" && c.ops % 2 === 1) {
    const cat = TILE_SPECS[tile.type].category;
    emit(c, "citizen", {
      persona: [
        "程序员小李",
        "带娃妈妈王姐",
        "个体户老周",
        "退休教师陈伯",
        "外地租客阿紫",
      ][c.ops % 5],
      text: CITIZEN[cat],
      sentiment: cat === "industrial" ? "angry" : "happy",
      topic: cat === "service" ? "edu" : cat === "green" ? "green" : "commute",
      source: "template",
    });
  }
  if (c.ops % 3 === 0) {
    emit(c, "news", {
      headline: NEWS[c.ops % NEWS.length],
      body: `第 ${c.cityYear} 年：人口 ${c.metrics.population}，幸福度 ${c.metrics.happiness}。`,
      severity: c.metrics.happiness < 40 ? "warning" : "info",
      at_year: c.cityYear,
      source: "template",
    });
  }
  if (c.ops % 5 === 0) {
    emit(c, "mentor", {
      comment:
        c.metrics.job_res_ratio < 0.8
          ? "住宅偏多、岗位不足，留意职住平衡。"
          : "布局不错，记得补齐学校与绿地。",
      theory_refs: [
        c.metrics.job_res_ratio < 0.8
          ? "jobs_housing_balance"
          : "life_circle_15",
      ],
      severity: "suggestion",
      top_issues: [],
      source: "template",
    });
  }
}

const playing = new Set<string>();

/** 推演播放：逐年推送 projection_step，结束后回到建设（10 §3：只读预览，不写回）。
 *  页面刷新后由 subscribe 续播剩余年份。 */
function schedulePlayback(id: string) {
  if (playing.has(id)) return;
  playing.add(id);
  const tickOnce = () => {
    const cur = load(id);
    if (cur.phase !== "projecting") {
      playing.delete(id);
      return;
    }
    const next = cur.projection.find((p) => p.year > cur.projectionPublished);
    if (next) {
      cur.projectionPublished = next.year;
      emit(cur, "projection_step", {
        year: next.year,
        metrics: next.metrics,
        events: next.events,
        source: "template",
      });
      setTimeout(tickOnce, 800);
      return;
    }
    cur.phase = "building";
    emit(cur, "phase_change", phaseData("build"));
    playing.delete(id);
  };
  setTimeout(tickOnce, 800);
}

function scoresOf(m: Metrics): Scores {
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)));
  return {
    population: clamp(m.population / 300),
    balance: clamp(100 - Math.abs(1 - m.job_res_ratio) * 100),
    green: clamp((m.green_ratio / 0.3) * 100),
    traffic: clamp(100 - m.congestion * 70),
    happiness: clamp(m.happiness),
  };
}

function endingOf(m: Metrics): Ending {
  if (m.funds < 0 && m.tax_income < m.upkeep * 0.8) return "bankrupt";
  if (m.avg_commute > 75 && m.congestion > 0.9) return "gridlock";
  if (
    m.happiness >= 70 &&
    m.job_res_ratio >= 0.85 &&
    m.job_res_ratio <= 1.15 &&
    m.congestion < 0.6
  )
    return "thriving";
  return "ordinary";
}

export const mockApi: CityApi = {
  kind: "mock",
  capabilities: {
    advanceYear: true,
    project: true,
    report: true,
    projectLocksCity: false,
  },

  async create() {
    const id = `mock_${Math.random().toString(36).slice(2, 8)}`;
    const c: MockCity = {
      id,
      phase: "briefing",
      cityYear: 1,
      tiles: [],
      metrics: compute([], 5_000_000, 1, "briefing"),
      ops: 0,
      nextEventId: 1,
      events: [],
      projection: [],
      projectionPublished: 0,
      scores: null,
      ending: null,
      report: null,
    };
    save(c);
    return { id };
  },

  async load(id) {
    return snapshot(load(id));
  },

  async startPlanning(id) {
    const c = load(id);
    if (c.phase !== "briefing")
      throw new ApiError(400, "invalid_phase", "当前阶段不允许操作");
    c.phase = "building";
    c.metrics = { ...c.metrics, at_phase: "build" };
    emit(c, "phase_change", phaseData("build"));
    return { phase: c.phase };
  },

  async place(id, input) {
    const c = load(id);
    requireBuilding(c);
    const occ = new Set(
      c.tiles.flatMap((t) => t.cells.map(([r, cc]) => occupiedKey(r, cc))),
    );
    const chk = checkPlacement(
      parcel,
      occ,
      c.metrics.funds,
      input.type,
      input.anchor,
    );
    if (!chk.ok) {
      const status =
        chk.code === "insufficient_funds"
          ? 402
          : chk.code === "cell_occupied"
            ? 409
            : 400;
      throw new ApiError(status, chk.code!, chk.reason!, {
        cells: chk.cells,
        cost: chk.cost,
        funds: c.metrics.funds,
      });
    }
    const before = c.metrics;
    const tile: Tile = {
      id: `tile_${Math.random().toString(16).slice(2, 6)}`,
      type: input.type,
      anchor: input.anchor,
      cells: chk.cells,
      ...(input.type === "util_bridge"
        ? { orientation: input.orientation ?? "horizontal" }
        : {}),
      built_at_year: c.cityYear,
      upkeep: UPKEEP[input.type],
    };
    c.tiles = [...c.tiles, tile];
    c.metrics = compute(c.tiles, before.funds - chk.cost, c.cityYear, c.phase);
    afterOp(c, before, tile, "place");
    save(c);
    const result: PlaceResult = {
      tile,
      metrics: c.metrics,
      metrics_diff: diff(before, c.metrics),
      funds_after: c.metrics.funds,
    };
    return result;
  },

  async remove(id, tileId) {
    const c = load(id);
    requireBuilding(c);
    const tile = c.tiles.find((t) => t.id === tileId);
    if (!tile)
      throw new ApiError(400, "invalid_placement", `区块 ${tileId} 不存在`);
    const before = c.metrics;
    c.tiles = c.tiles.filter((t) => t.id !== tileId);
    c.metrics = compute(
      c.tiles,
      before.funds + estimateRefund(parcel, tile.type, tile.cells),
      c.cityYear,
      c.phase,
    );
    afterOp(c, before, tile, "remove");
    save(c);
    return {
      tile,
      metrics: c.metrics,
      metrics_diff: diff(before, c.metrics),
      funds_after: c.metrics.funds,
    };
  },

  async advanceYear(id) {
    const c = load(id);
    requireBuilding(c);
    const before = c.metrics;
    c.cityYear += 1;
    const net = before.tax_income - before.upkeep;
    c.metrics = compute(c.tiles, before.funds + net, c.cityYear, c.phase);
    const d = diff(before, c.metrics);
    emit(c, "city_year", {
      city_year: c.cityYear,
      metrics_diff: d,
      events: [net >= 0 ? `年度结余 ${net} 元` : `年度赤字 ${-net} 元`],
    });
    emit(c, "tick", d);
    return { cityYear: c.cityYear, metrics: c.metrics, phase: "building" };
  },

  async project(id) {
    const c = load(id);
    requireBuilding(c);
    const proj: ProjectionYear[] = [];
    let m = c.metrics;
    for (let i = 1; i <= 10; i++) {
      const funds = m.funds + m.tax_income - m.upkeep;
      m = {
        ...m,
        at_year: c.cityYear + i,
        funds,
        population: Math.round(m.population * 1.03),
      };
      proj.push({
        year: c.cityYear + i,
        metrics: m,
        events: i === 5 ? ["人口稳步增长"] : [],
        source: "template",
      });
    }
    c.projection = proj;
    c.projectionPublished = 0;
    c.phase = "projecting";
    emit(c, "phase_change", phaseData("locked"));
    save(c);
    schedulePlayback(id);
    return { phase: c.phase, projection: proj };
  },

  async report(id) {
    const c = load(id);
    requireBuilding(c);
    const scores = scoresOf(c.metrics);
    const ending = endingOf(c.metrics);
    const dim = (k: keyof Scores) => `${k} 得分 ${scores[k]}。`;
    const report: Report = {
      overview: `第 ${c.cityYear} 年体检：人口 ${c.metrics.population}，幸福度 ${c.metrics.happiness}。`,
      dimensions: {
        population: dim("population"),
        balance: dim("balance"),
        green: dim("green"),
        traffic: dim("traffic"),
        happiness: dim("happiness"),
      },
      ending_story: "（mock 模板文案）",
      source: "template",
    };
    Object.assign(c, { phase: "report", scores, ending, report });
    emit(c, "phase_change", phaseData("report"));
    emit(c, "report_ready", {
      report,
      city_name: "演示市",
      source: "template",
    });
    return { phase: c.phase, scores, ending, report, cityName: "演示市" };
  },

  async backToBuilding(id) {
    const c = load(id);
    c.phase = "building";
    emit(c, "phase_change", phaseData("build"));
    return { phase: c.phase };
  },

  subscribe(id, handlers) {
    let set = subscribers.get(id);
    if (!set) subscribers.set(id, (set = new Set()));
    set.add(handlers);
    handlers.onConn("open", null);
    try {
      if (load(id).phase === "projecting") schedulePlayback(id);
    } catch {
      /* 城市不存在：交给 load 报 404 */
    }
    return () => set!.delete(handlers);
  },
};
