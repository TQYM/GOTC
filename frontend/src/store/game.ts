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
  Metrics,
  MetricKey,
  Parcel,
  Tile,
  TileType,
} from "@/lib/contract";
import {
  ApiError,
  type CityApi,
  type CitySnapshot,
  type GamePhase,
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

  init(api: CityApi, id: string): Promise<void>;
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

    async init(api, id) {
      set({
        api,
        id,
        status: "loading",
        loadError: null,
        tool: { kind: "select" },
        confirmRemove: null,
      });
      try {
        get().applySnapshot(await api.load(id));
        set({ status: "ready" });
      } catch (e) {
        const msg = e instanceof ApiError ? humanizeError(e).title : "加载失败";
        set({ status: "error", loadError: msg });
      }
    },

    applySnapshot(s) {
      set({
        parcel: s.parcel,
        tiles: s.tiles,
        metrics: s.metrics,
        phase: s.phase,
        cityYear: s.cityYear,
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
        set({ phase: r.phase });
      } catch (e) {
        fail(e, null, () => void get().startPlanning());
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
