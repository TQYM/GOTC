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
import type { OperationResult, ReportResult, SharedPhase } from "@/lib/contractV2";
import type { BuildingsFile, ExistingAsset } from "@saves/lib/types";
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
import { withBase } from "@/lib/api/base";

export type Tool =
  | { kind: "select" }
  | { kind: "place"; type: TileType }
  | { kind: "remove" }
  | { kind: "redevelop" };

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
  reportId?: string;
  baseYear?: number;
  baseSeq?: number;
  createdAt?: string;
}

export interface RemoveRequest {
  tile: Tile;
  refund: number;
}

interface GameState {
  api: CityApi | null;
  id: string | null;
  cityName: string | null;
  status: "idle" | "loading" | "ready" | "error";
  loadError: string | null;
  /** 本端可见视图；共享持久化阶段单独保存，其他端不能强制切换本端预览。 */
  phase: GamePhase;
  sharedPhase: SharedPhase;
  cityYear: number;
  lastSeq: number;
  redevelopedAssetIds: string[];
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
  projectionId: string | null;
  projectionBaseYear: number | null;
  projectionBaseSeq: number | null;
  cityReport: CityReport | null;
  reportHistory: ReportResult[];
  bridgeOrientation: "horizontal" | "vertical";
  /** 二级界面：当前选中的格子（null = 未选中，详情卡收起） */
  selected: Cell | null;
  /** 既有建筑索引（"r:c" → asset），来自数据包 buildings.json，用于点选详情与拆除 */
  existingAssets: Record<string, ExistingAsset>;
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
  /** 指定类型就地建造（详情卡里的「在这里建」入口，不依赖当前工具） */
  buildAt(type: TileType, anchor: Cell): Promise<void>;
  redevelopAt(c: Cell): Promise<void>;
  /** 选中/取消选中格子，驱动二级详情界面 */
  selectAt(cell: Cell | null): void;
  /** 拉取既有建筑索引（点选详情与拆除用）；失败不阻塞游戏 */
  loadExistingAssets(): Promise<void>;
  /** 拆除地图上的既有建筑（后端 redevelop：付拆迁费、扣除现状人口岗位、幸福度 −5） */
  demolishExisting(anchor: Cell): Promise<void>;
  setBridgeOrientation(value: "horizontal" | "vertical"): void;
  loadReports(): Promise<void>;
  openReport(result: ReportResult): void;
  askMentor(): Promise<void>;
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

function operationOf(result: unknown): OperationResult | null {
  if (!result || typeof result !== "object") return null;
  const candidate = result as Partial<OperationResult>;
  return typeof candidate.seq === "number" && Array.isArray(candidate.tiles)
    ? candidate as OperationResult
    : null;
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

  const applyOperation = (result: OperationResult): boolean => {
    const s = get();
    if (result.seq <= s.lastSeq) return false;
    if (result.seq > s.lastSeq + 1) {
      // op seq 与 SSE event id 无关；只有 op 序号缺口需要全量恢复。
      void get().resync();
      return false;
    }
    const redevelopedCells = new Set(
      result.redevelopment?.cells.map(([r, c]) => `${r},${c}`) ?? [],
    );
    const parcel = s.parcel && redevelopedCells.size ? {
      ...s.parcel,
      terrain: s.parcel.terrain.map((row, r) => row.map((terrain, c) =>
        redevelopedCells.has(`${r},${c}`) ? "flat" as const : terrain,
      )),
    } : s.parcel;
    const nextRedevelopedIds = s.redevelopedAssetIds.length === result.redeveloped_asset_ids.length &&
      s.redevelopedAssetIds.every((assetId, index) => assetId === result.redeveloped_asset_ids[index])
      ? s.redevelopedAssetIds
      : result.redeveloped_asset_ids;
    set({
      parcel,
      tiles: result.tiles,
      redevelopedAssetIds: nextRedevelopedIds,
      cityYear: result.city_year,
      lastSeq: result.seq,
    });
    applyMetrics(result.metrics);
    if (result.annual_events.length) {
      set((state) => ({
        feed: [...state.feed, ...result.annual_events.map((text, index) => ({
          key: `annual-${result.seq}-${index}`,
          kind: "system" as const,
          text,
        }))].slice(-FEED_LIMIT),
      }));
    }
    return true;
  };

  return {
    api: null,
    id: null,
    cityName: null,
    status: "idle",
    loadError: null,
    phase: "briefing",
    sharedPhase: "briefing",
    cityYear: 1,
    lastSeq: 0,
    redevelopedAssetIds: [],
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
    projectionId: null,
    projectionBaseYear: null,
    projectionBaseSeq: null,
    cityReport: null,
    reportHistory: [],
    bridgeOrientation: "horizontal",
    selected: null,
    existingAssets: {},
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
        phase: "briefing",
        sharedPhase: "briefing",
        cityYear: 1,
        lastSeq: 0,
        parcel: null,
        tiles: [],
        metrics: null,
        redevelopedAssetIds: [],
        selected: null,
        existingAssets: {},
        projection: [],
        projectionYear: 0,
        projectionId: null,
        projectionBaseYear: null,
        projectionBaseSeq: null,
        cityReport: null,
        reportHistory: [],
        phaseEventId: -1,
        lastEventId: -1,
      });
      try {
        get().applySnapshot(await api.load(id));
        set({ status: "ready" });
        void get().loadExistingAssets();
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
      if (eventId !== undefined && eventId !== null && eventId < s.phaseEventId) return;
      const sharedPhase: SharedPhase = p === "briefing" ? "briefing" : "building";
      const preserveLocal = s.api?.kind === "v2" && eventId != null && p === "building" &&
        (s.phase === "projecting" || s.phase === "report");
      set({
        sharedPhase,
        phase: preserveLocal ? s.phase : p,
        phaseEventId: eventId ?? Math.max(s.phaseEventId, s.lastEventId),
      });
      if (!preserveLocal && p !== "building" && get().tool.kind !== "select")
        set({ tool: { kind: "select" }, confirmRemove: null });
    },

    applyEvent(e) {
      if (e.id !== null && e.id > get().lastEventId) set({ lastEventId: e.id });
      switch (e.event) {
        case "snapshot":
          get().applySnapshot(e.data);
          return;
        case "op_applied":
          applyOperation(e.data);
          return;
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
          if (e.data.city_year !== undefined) set({ cityYear: e.data.city_year });
          return;
        case "city_year":
          if (e.data.city_year >= get().cityYear)
            set({ cityYear: e.data.city_year });
          return;
        case "projection_step":
          // v2 ProjectionPlayer 消费完整本端结果；忽略其他端/服务端的瞬时连发。
          // 本地播放器用 id=null 显式推进；v1 仍兼容原来的 SSE 播放。
          if (get().api?.kind === "v2" && e.id !== null) return;
          if (get().phase !== "projecting") return;
          // 只前进不重播：已播放过的年份（含断线补发）直接忽略
          if (e.data.year > get().projectionYear)
            set({ projectionYear: e.data.year });
          return;
        case "report_ready": {
          const cur = get().cityReport;
          const reportId = "report_id" in e.data ? e.data.report_id : null;
          if (cur && (!reportId || !cur.reportId || cur.reportId === reportId))
            set({
              cityReport: {
                ...cur,
                report: e.data.report,
                cityName: e.data.city_name,
              },
            });
          if (reportId && "report_id" in e.data) {
            const result = e.data;
            set((state) => ({
              reportHistory: state.reportHistory.some((r) => r.report_id === reportId)
                ? state.reportHistory.map((r) => r.report_id === reportId ? result : r)
                : [result, ...state.reportHistory].slice(0, 20),
            }));
          }
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
      const sharedPhase: SharedPhase = s.phase === "briefing" ? "briefing" : "building";
      const current = get();
      if (current.id === s.id && s.lastSeq < current.lastSeq) return;
      const keepLocalView = sharedPhase === "building" &&
        (current.phase === "projecting" || current.phase === "report");
      const snapshotView = s.phase === "projecting" || s.phase === "report" ? s.phase : null;
      const phase = snapshotView ?? (keepLocalView ? current.phase : sharedPhase);
      set({
        id: s.id,
        cityName: s.name ?? s.cityName,
        parcel: s.parcel,
        tiles: s.tiles,
        redevelopedAssetIds: s.redevelopedAssetIds,
        metrics: s.metrics,
        sharedPhase,
        phase,
        cityYear: s.cityYear,
        lastSeq: s.lastSeq,
        projection: s.projection.length ? s.projection : (phase === "projecting" ? current.projection : []),
        projectionYear: s.projectionPublishedYear || current.projectionYear,
        projectionId: s.projectionId ?? current.projectionId,
        projectionBaseYear: s.projectionBaseYear ?? current.projectionBaseYear,
        projectionBaseSeq: s.projectionBaseSeq ?? current.projectionBaseSeq,
        cityReport: s.scores && s.ending && s.report ? {
          scores: s.scores,
          ending: s.ending,
          report: s.report,
          cityName: s.cityName,
        } : (phase === "report" ? current.cityReport : null),
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
        if (r.snapshot) get().applySnapshot(r.snapshot);
        else get().setPhase(r.phase);
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
        if (r.operation) applyOperation(r.operation);
        else applyMetrics(r.metrics);
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
        set({
          projection: r.projection,
          projectionYear: 0,
          projectionId: r.projectionId ?? null,
          projectionBaseYear: r.baseYear ?? null,
          projectionBaseSeq: r.baseSeq ?? null,
          cityReport: null,
        });
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
        set((state) => ({
          cityReport: {
            scores: r.scores,
            ending: r.ending,
            report: r.report,
            cityName: r.cityName,
            reportId: r.result?.report_id,
            baseYear: r.result?.base_year,
            baseSeq: r.result?.base_seq,
            createdAt: r.result?.created_at,
          },
          reportHistory: r.result
            ? [r.result, ...state.reportHistory.filter((item) => item.report_id !== r.result!.report_id)].slice(0, 20)
            : state.reportHistory,
        }));
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
      if (api.kind === "v2") {
        get().setPhase(get().sharedPhase);
        return;
      }
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
      const tool = get().tool;
      if (tool.kind !== "place") return;
      await get().buildAt(tool.type, anchor);
    },

    /** 就地建造：详情卡与卡牌工具共用同一套校验、请求与结果处理 */
    async buildAt(type, anchor) {
      const { api, id, parcel, tiles, metrics, busy, phase, bridgeOrientation } = get();
      if (!api || !id || !parcel || busy) return;
      if (phase !== "building") return;
      const chk = checkPlacement(
        parcel,
        occupiedSet(tiles),
        metrics?.funds ?? null,
        type,
        anchor,
        type === "util_bridge" ? bridgeOrientation : undefined,
      );
      if (!chk.ok) {
        // 非法格禁止落下：不发请求，只给人话原因
        get().toast({ tone: "error", title: chk.reason ?? "这里不能建" });
        return;
      }
      set({ busy: true });
      try {
        const r = await api.place(id, {
          type,
          anchor,
          ...(type === "util_bridge"
            ? { orientation: bridgeOrientation }
            : {}),
        });
        const op = operationOf(r);
        if (op) applyOperation(op);
        else {
          set((s) => ({ tiles: [...s.tiles, r.tile] }));
          applyMetrics(r.metrics);
        }
        get().toast({
          tone: "ok",
          title: `${TILE_SPECS[type].name}建好了`,
          hint: `花费 ${yuan(metrics ? metrics.funds - r.funds_after : chk.cost)}${chk.warning ? ` · ${chk.warning}` : ""}`,
        });
      } catch (e) {
        fail(e, chk.reason, () => void get().buildAt(type, anchor));
      } finally {
        set({ busy: false });
      }
    },

    selectAt(cell) {
      set({ selected: cell });
    },

    async loadExistingAssets() {
      const { parcel } = get();
      const url = parcel?.buildings_url;
      if (!url) return;
      try {
        const res = await fetch(withBase(url));
        if (!res.ok) return;
        const file = (await res.json()) as BuildingsFile;
        const map: Record<string, ExistingAsset> = {};
        for (const list of Object.values(file.chunks ?? {})) {
          for (const asset of list) {
            for (const [r, c] of asset.cells) map[`${r}:${c}`] = asset;
          }
        }
        set({ existingAssets: map });
      } catch {
        /* 索引失败只影响详情卡，不阻塞建设玩法 */
      }
    },

    async demolishExisting(anchor) {
      const { api, id, busy, phase, existingAssets } = get();
      if (!api?.redevelop || !id || busy) return;
      if (phase !== "building") return;
      const asset = existingAssets[`${anchor[0]}:${anchor[1]}`];
      if (!asset) {
        get().toast({ tone: "info", title: "这个格子没有既有建筑" });
        return;
      }
      if (busy) return;
      set({ busy: true });
      try {
        const result = await api.redevelop(id, anchor);
        applyOperation(result);
        const detail = result.redevelopment;
        get().toast({
          tone: "ok",
          title: detail?.asset_id ? `已拆除${asset.name ?? "既有建筑"}` : "已拆除既有建筑",
          hint: detail
            ? `释放 ${detail.cells.length} 格 · 拆迁 ${yuan(detail.demolition_cost)} · 幸福度 ${detail.happiness_delta}`
            : undefined,
        });
        // 释放掉的资产要从索引里移除：否则这些格子仍被当成既有建筑，会重复触发拆除
        set((state) => {
          const next = { ...state.existingAssets };
          for (const [r, c] of asset.cells) delete next[`${r}:${c}`];
          return { existingAssets: next, selected: null };
        });
      } catch (e) {
        fail(e, null, () => void get().demolishExisting(anchor));
      } finally {
        set({ busy: false });
      }
    },

    setBridgeOrientation(value) {
      set({ bridgeOrientation: value });
    },

    async redevelopAt(anchor) {
      const { api, id, parcel, tool, busy, phase } = get();
      if (!api || !id || !parcel || tool.kind !== "redevelop" || busy || phase !== "building") return;
      if (!api.redevelop) {
        get().toast({ tone: "info", title: "当前模式不支持既有建筑更新改造" });
        return;
      }
      if (parcel.terrain[anchor[0]]?.[anchor[1]] !== "occupied") {
        get().toast({ tone: "info", title: "请点击既有建筑的 occupied 格" });
        return;
      }
      set({ busy: true });
      const before = get().metrics?.funds ?? 0;
      try {
        const result = await api.redevelop(id, anchor);
        applyOperation(result);
        const detail = result.redevelopment;
        get().toast({
          tone: "ok",
          title: detail ? `已完成 ${detail.asset_id} 更新改造` : "更新改造完成",
          hint: detail
            ? `释放 ${detail.cells.length} 格 · 拆迁 ${yuan(detail.demolition_cost)} · 幸福度 ${detail.happiness_delta}`
            : `资金变化 ${yuan(result.funds_after - before)}`,
        });
        const freed = detail?.cells ?? [];
        if (freed.length) {
          set((state) => {
            const next = { ...state.existingAssets };
            for (const [r, c] of freed) delete next[`${r}:${c}`];
            return { existingAssets: next };
          });
        }
      } catch (e) {
        fail(e, null, () => void get().redevelopAt(anchor));
      } finally {
        set({ busy: false });
      }
    },

    async loadReports() {
      const { api, id } = get();
      if (!api?.reports || !id) return;
      try {
        set({ reportHistory: await api.reports(id) });
      } catch (e) {
        fail(e);
      }
    },

    openReport(result) {
      set({
        cityReport: {
          scores: result.scores,
          ending: result.ending,
          report: result.report,
          cityName: result.city_name,
          reportId: result.report_id,
          baseYear: result.base_year,
          baseSeq: result.base_seq,
          createdAt: result.created_at,
        },
      });
      get().setPhase("report");
    },

    async askMentor() {
      const { api, id, busy } = get();
      if (!api?.mentor || !id || busy) return;
      set({ busy: true });
      try {
        await api.mentor(id);
        get().toast({ tone: "info", title: "已请教规划导师", hint: "建议稍后经信息流到达，不会阻塞建设" });
      } catch (e) {
        fail(e, null, () => void get().askMentor());
      } finally {
        set({ busy: false });
      }
    },

    requestRemoveAt(cell) {
      const { parcel, tiles, busy } = get();
      if (!parcel || busy) return;
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
        const before = get().metrics?.funds ?? r.funds_after;
        const op = operationOf(r);
        set({ confirmRemove: null });
        if (op) applyOperation(op);
        else {
          set((s) => ({ tiles: s.tiles.filter((t) => t.id !== tile.id) }));
          applyMetrics(r.metrics);
        }
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
