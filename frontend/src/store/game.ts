/**
 * 游戏会话 store（05 §2.4：前端唯一的状态真相，Zustand）。
 *
 * 纪律：
 * - 阶段迁移只信 REST 响应与推送事件，本地只做「乐观显示」（悬停/预览），不做乐观迁移；
 * - 放置/拆除失败时本地状态零变更，只弹人话 toast；
 * - 同一时刻最多一个写请求在途（防连点重复落子 = 零误触）。
 */
import { create } from "zustand";
import type {
  Cell,
  Ending,
  Metrics,
  ProjectionYear,
  Report,
  Scores,
  MetricKey,
  Parcel,
  Tile,
  TileType,
} from "@/lib/contract";
import {
  ApiError,
  toGamePhase,
  type CityApi,
  type CitySnapshot,
  type ConnState,
  type GamePhase,
  type StreamEvent,
  type StreamEventMap,
} from "@/lib/api";
import { humanizeError, yuan } from "@/lib/api/humanize";
import { TILE_SPECS } from "@/lib/catalog";
import { checkPlacement, estimateRefund, occupiedKey } from "@/lib/validate";

export type Tool =
  { kind: "select" } | { kind: "place"; type: TileType } | { kind: "remove" };

export interface Toast {
  id: number;
  tone: "ok" | "error" | "info";
  title: string;
  hint?: string;
  retry?: () => void;
}

/** 信息流条目（05 §2.3 InfoFeed）：三角色 + 系统提示 */
export type FeedItem =
  | { key: string; kind: "news"; data: StreamEventMap["news"] }
  | { key: string; kind: "citizen"; data: StreamEventMap["citizen"] }
  | { key: string; kind: "mentor"; data: StreamEventMap["mentor"] }
  | { key: string; kind: "system"; text: string };

const FEED_LIMIT = 200;

/** 城市诊断结果（随时生成，10 §3） */
export interface CityReport {
  scores: Scores;
  ending: Ending;
  report: Report;
  cityName: string | null;
}

export interface RemoveRequest {
  tile: Tile;
  refund: number;
}

interface GameState {
  api: CityApi | null;
  id: string | null;
  status: "idle" | "loading" | "ready" | "error";
  loadError: string | null;
  phase: GamePhase;
  cityYear: number;
  parcel: Parcel | null;
  tiles: Tile[];
  metrics: Metrics | null;
  /** 指标脉冲（05 §2.3：升绿降红 300ms），token 变化触发动画 */
  pulse: { token: number; dir: Partial<Record<MetricKey, 1 | -1>> };
  tool: Tool;
  busy: boolean;
  toasts: Toast[];
  confirmRemove: RemoveRequest | null;
  feed: FeedItem[];
  /** 完整推演切片（后端预计算）与已播放到的年份 */
  projection: ProjectionYear[];
  projectionYear: number;
  cityReport: CityReport | null;
  /** 已应用的最大推送 id：阶段类事件按 id 单调前进，乱序/重放的旧事件被忽略 */
  phaseEventId: number;
  lastEventId: number;
  conn: ConnState;
  /** 断线开始时间（ms），用于「超过 30s 提示刷新」 */
  downSince: number | null;

  init(api: CityApi, id: string): Promise<void>;
  /** 订阅推送；返回退订函数（由页面 effect 管理生命周期） */
  connect(): () => void;
  applyEvent(e: StreamEvent): void;
  resync(): Promise<void>;
  /** 后端确认的阶段迁移（REST 响应或推送），本地不做乐观迁移 */
  setPhase(p: GamePhase, eventId?: number | null): void;
  advanceYear(): Promise<void>;
  project(): Promise<void>;
  makeReport(): Promise<void>;
  backToBuilding(): Promise<void>;
  applySnapshot(s: CitySnapshot): void;
  setTool(t: Tool): void;
  exitTool(): void;
  startPlanning(): Promise<void>;
  placeAt(anchor: Cell): Promise<void>;
  requestRemoveAt(cell: Cell): void;
  confirmRemoveNow(): Promise<void>;
  cancelRemove(): void;
  toast(t: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
}

let toastSeq = 1;

export function occupiedSet(tiles: Tile[]): Set<number> {
  const s = new Set<number>();
  for (const t of tiles) for (const [r, c] of t.cells) s.add(occupiedKey(r, c));
  return s;
}

export function tileAt(tiles: Tile[], [r, c]: Cell): Tile | undefined {
  return tiles.find((t) => t.cells.some(([tr, tc]) => tr === r && tc === c));
}

function pulseOf(
  prev: Metrics | null,
  next: Metrics,
): Partial<Record<MetricKey, 1 | -1>> {
  const dir: Partial<Record<MetricKey, 1 | -1>> = {};
  if (!prev) return dir;
  for (const k of Object.keys(next) as (keyof Metrics)[]) {
    if (k === "at_year" || k === "at_phase") continue;
    const d = (next[k] as number) - (prev[k] as number);
    if (d > 0) dir[k] = 1;
    else if (d < 0) dir[k] = -1;
  }
  return dir;
}

export const useGame = create<GameState>()((set, get) => {
  const fail = (
    e: unknown,
    localReason?: string | null,
    retry?: () => void,
  ) => {
    if (e instanceof ApiError) {
      const h = humanizeError(e, localReason);
      get().toast({
        tone: "error",
        title: h.title,
        hint: h.hint,
        retry: h.retryable ? retry : undefined,
      });
    } else {
      get().toast({
        tone: "error",
        title: e instanceof Error ? e.message : "操作失败",
      });
    }
  };

  const applyMetrics = (m: Metrics) =>
    set((s) => ({
      metrics: m,
      pulse: { token: s.pulse.token + 1, dir: pulseOf(s.metrics, m) },
    }));

  return {
    api: null,
    id: null,
    status: "idle",
    loadError: null,
    phase: "briefing",
    cityYear: 1,
    parcel: null,
    tiles: [],
    metrics: null,
    pulse: { token: 0, dir: {} },
    tool: { kind: "select" },
    busy: false,
    toasts: [],
    confirmRemove: null,
    feed: [],
    projection: [],
    projectionYear: 0,
    cityReport: null,
    phaseEventId: -1,
    lastEventId: -1,
    conn: "connecting",
    downSince: null,

    async init(api, id) {
      set({
        api,
        id,
        status: "loading",
        loadError: null,
        tool: { kind: "select" },
        confirmRemove: null,
        feed: [],
        phaseEventId: -1,
        lastEventId: -1,
      });
      try {
        get().applySnapshot(await api.load(id));
        set({ status: "ready" });
      } catch (e) {
        const msg = e instanceof ApiError ? humanizeError(e).title : "加载失败";
        set({ status: "error", loadError: msg });
      }
    },

    connect() {
      const { api, id } = get();
      if (!api || !id) return () => {};
      let wasDown = false;
      return api.subscribe(id, {
        onEvent: (e) => get().applyEvent(e),
        onConn: (conn, downSince) => {
          set({ conn, downSince });
          if (conn === "down") wasDown = true;
          if (conn === "open" && wasDown) {
            // 重连成功：后端已按 Last-Event-ID 补发；再拉一次全量兜底（05 §3.3）
            wasDown = false;
            void get().resync();
          }
        },
      });
    },

    async resync() {
      const { api, id } = get();
      if (!api || !id) return;
      try {
        get().applySnapshot(await api.load(id));
      } catch {
        /* 全量恢复失败不打扰玩家，下次重连再试 */
      }
    },

    setPhase(p, eventId) {
      const s = get();
      if (eventId !== undefined && eventId !== null) {
        if (eventId < s.phaseEventId) return; // 乱序到达的旧阶段事件：不回退
        set({ phase: p, phaseEventId: eventId });
      } else {
        // REST 响应：以已见过的最新事件 id 为基线，之后补发的旧阶段事件不会覆盖它
        set({
          phase: p,
          phaseEventId: Math.max(s.phaseEventId, s.lastEventId),
        });
      }
      if (p !== "building" && get().tool.kind !== "select")
        set({ tool: { kind: "select" }, confirmRemove: null });
    },

    applyEvent(e) {
      if (e.id !== null && e.id > get().lastEventId) set({ lastEventId: e.id });
      switch (e.event) {
        case "tick": {
          const d = e.data;
          const cur = get().metrics;
          const changed = Object.keys(d.delta).length > 0;
          if (d.after) {
            if (changed) applyMetrics(d.after);
            else set({ metrics: d.after });
          } else if (cur && changed) {
            const next = { ...cur } as unknown as Record<string, number>;
            for (const [k, v] of Object.entries(d.delta))
              next[k] += v as number;
            applyMetrics(next as unknown as Metrics);
          }
          set({ cityYear: d.at_year });
          return;
        }
        case "phase_change":
          get().setPhase(toGamePhase(e.data.phase), e.id);
          return;
        case "city_year":
          if (e.data.city_year >= get().cityYear)
            set({ cityYear: e.data.city_year });
          return;
        case "projection_step":
          // 只前进不重播：已播放过的年份（含断线补发）直接忽略
          if (e.data.year > get().projectionYear)
            set({ projectionYear: e.data.year });
          return;
        case "report_ready": {
          const cur = get().cityReport;
          if (cur)
            set({
              cityReport: {
                ...cur,
                report: e.data.report,
                cityName: e.data.city_name,
              },
            });
          return;
        }
        case "news":
        case "citizen":
        case "mentor": {
          const key = `${e.id ?? "x"}:${e.event}`;
          if (get().feed.some((f) => f.key === key)) return; // 补发去重
          const item = { key, kind: e.event, data: e.data } as FeedItem;
          set((s) => ({ feed: [...s.feed, item].slice(-FEED_LIMIT) }));
          return;
        }
        case "error": {
          const item: FeedItem = {
            key: `${e.id ?? Date.now()}:error`,
            kind: "system",
            text: e.data.message,
          };
          set((s) => ({ feed: [...s.feed, item].slice(-FEED_LIMIT) }));
          return;
        }
        default:
          return;
      }
    },

    applySnapshot(s) {
      set({
        parcel: s.parcel,
        tiles: s.tiles,
        metrics: s.metrics,
        phase: s.phase,
        cityYear: s.cityYear,
        projection: s.projection,
        projectionYear: s.projectionPublishedYear,
        cityReport:
          s.scores && s.ending && s.report
            ? {
                scores: s.scores,
                ending: s.ending,
                report: s.report,
                cityName: s.cityName,
              }
            : null,
      });
    },

    setTool(t) {
      if (t.kind !== "select" && get().phase !== "building") {
        get().toast({ tone: "info", title: "先点「开始规划」再建设" });
        return;
      }
      set({ tool: t });
    },

    exitTool() {
      set({ tool: { kind: "select" } });
    },

    async startPlanning() {
      const { api, id, busy } = get();
      if (!api || !id || busy) return;
      set({ busy: true });
      try {
        const r = await api.startPlanning(id);
        get().setPhase(r.phase);
      } catch (e) {
        fail(e, null, () => void get().startPlanning());
      } finally {
        set({ busy: false });
      }
    },

    async advanceYear() {
      const { api, id, busy, phase } = get();
      if (!api || !id || busy || phase !== "building") return;
      set({ busy: true });
      try {
        const r = await api.advanceYear(id);
        applyMetrics(r.metrics);
        // 年份只信后端：取响应值，不在本地 +1
        set({ cityYear: Math.max(get().cityYear, r.cityYear) });
        get().setPhase(r.phase);
        get().toast({ tone: "ok", title: `进入第 ${r.cityYear} 年` });
      } catch (e) {
        fail(e, null, () => void get().advanceYear());
      } finally {
        set({ busy: false });
      }
    },

    async project() {
      const { api, id, busy, phase } = get();
      if (!api || !id || busy || phase !== "building") return;
      set({ busy: true });
      try {
        const r = await api.project(id);
        set({ projection: r.projection, projectionYear: 0 });
        if (r.final) {
          set({
            cityReport: {
              scores: r.final.scores,
              ending: r.final.ending,
              report: r.final.report,
              cityName: r.final.city_name,
            },
          });
        }
        get().setPhase(r.phase);
      } catch (e) {
        fail(e, null, () => void get().project());
      } finally {
        set({ busy: false });
      }
    },

    async makeReport() {
      const { api, id, busy, phase } = get();
      if (!api || !id || busy || phase !== "building") return;
      set({ busy: true });
      try {
        const r = await api.report(id);
        set({
          cityReport: {
            scores: r.scores,
            ending: r.ending,
            report: r.report,
            cityName: r.cityName,
          },
        });
        get().setPhase(r.phase);
      } catch (e) {
        fail(e, null, () => void get().makeReport());
      } finally {
        set({ busy: false });
      }
    },

    async backToBuilding() {
      const { api, id, busy } = get();
      if (!api || !id || busy) return;
      set({ busy: true });
      try {
        const r = await api.backToBuilding(id);
        get().setPhase(r.phase);
      } catch (e) {
        fail(e);
      } finally {
        set({ busy: false });
      }
    },

    async placeAt(anchor) {
      const { api, id, tool, parcel, tiles, metrics, busy, phase } = get();
      if (!api || !id || !parcel || tool.kind !== "place" || busy) return;
      if (phase !== "building") return;
      const chk = checkPlacement(
        parcel,
        occupiedSet(tiles),
        metrics?.funds ?? null,
        tool.type,
        anchor,
      );
      if (!chk.ok) {
        // 非法格禁止落下：不发请求，只给人话原因
        get().toast({ tone: "error", title: chk.reason ?? "这里不能建" });
        return;
      }
      set({ busy: true });
      const type = tool.type;
      try {
        const r = await api.place(id, {
          type,
          anchor,
          ...(type === "util_bridge"
            ? { orientation: "horizontal" as const }
            : {}),
        });
        set((s) => ({ tiles: [...s.tiles, r.tile] }));
        applyMetrics(r.metrics);
        get().toast({
          tone: "ok",
          title: `${TILE_SPECS[type].name}建好了`,
          hint: `花费 ${yuan(metrics ? metrics.funds - r.funds_after : chk.cost)}${chk.warning ? ` · ${chk.warning}` : ""}`,
        });
      } catch (e) {
        fail(e, chk.reason, () => void get().placeAt(anchor));
      } finally {
        set({ busy: false });
      }
    },

    requestRemoveAt(cell) {
      const { parcel, tiles, tool, busy } = get();
      if (!parcel || tool.kind !== "remove" || busy) return;
      const tile = tileAt(tiles, cell);
      if (!tile) {
        get().toast({ tone: "info", title: "这里没有可以拆的建筑" });
        return;
      }
      set({
        confirmRemove: {
          tile,
          refund: estimateRefund(parcel, tile.type, tile.cells),
        },
      });
    },

    async confirmRemoveNow() {
      const { api, id, confirmRemove, busy } = get();
      if (!api || !id || !confirmRemove || busy) return;
      set({ busy: true });
      const { tile } = confirmRemove;
      try {
        const r = await api.remove(id, tile.id);
        set((s) => ({
          tiles: s.tiles.filter((t) => t.id !== tile.id),
          confirmRemove: null,
        }));
        const before = get().metrics?.funds ?? r.funds_after;
        applyMetrics(r.metrics);
        get().toast({
          tone: "ok",
          title: `已拆除${TILE_SPECS[tile.type].name}`,
          hint: `返还 ${yuan(r.funds_after - before)}`,
        });
      } catch (e) {
        set({ confirmRemove: null });
        fail(e, null, () => {
          set({ confirmRemove });
          void get().confirmRemoveNow();
        });
      } finally {
        set({ busy: false });
      }
    },

    cancelRemove() {
      set({ confirmRemove: null });
    },

    toast(t) {
      const id = toastSeq++;
      set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
      setTimeout(() => get().dismissToast(id), t.retry ? 8000 : 3200);
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    },
  };
});
