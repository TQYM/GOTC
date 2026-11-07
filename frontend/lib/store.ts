import type { FeedItem, OperationResult, ReportResult, SaveState } from "./types";

export interface CityStore {
  state: SaveState | null;
  lastEventId: number;
  needsRecovery: boolean;
  connected: boolean;
  feed: FeedItem[];
  latestReport: ReportResult | null;
  pulse: { seq: number; anchor: [number, number] } | null;
}

export const initialCityStore: CityStore = {
  state: null,
  lastEventId: -1,
  needsRecovery: false,
  connected: false,
  feed: [],
  latestReport: null,
  pulse: null,
};

export type CityAction =
  | { type: "snapshot"; state: SaveState; eventId?: number }
  | { type: "operation"; result: OperationResult; remote: boolean; eventId?: number }
  | { type: "sse"; eventId: number; event: string; data: unknown; remote?: boolean }
  | { type: "connected"; value: boolean }
  | { type: "feed"; item: FeedItem }
  | { type: "report"; report: ReportResult }
  | { type: "reset" };

const OP_LABELS = { place: "新区块落格", remove: "区块拆除", redevelop: "现状更新", advance: "年度推进" };

function appendFeed(feed: FeedItem[], items: FeedItem[]): FeedItem[] {
  return [...feed, ...items].slice(-60);
}

export function applyOperation(
  store: CityStore,
  result: OperationResult,
  remote: boolean,
): CityStore {
  if (!store.state || result.seq <= store.state.last_seq) return store;
  const needsRecovery = result.seq > store.state.last_seq + 1;
  let parcel = store.state.parcel;
  if (result.redevelopment) {
    const terrain = parcel.terrain.map((row) => [...row]);
    for (const [row, col] of result.redevelopment.cells) {
      if (terrain[row]?.[col] === "occupied") terrain[row][col] = "flat";
    }
    parcel = { ...parcel, terrain };
  }
  const items: FeedItem[] = [];
  if (remote) {
    items.push({
      key: `op-${result.seq}`, kind: "system", title: "另一端已同步",
      text: `${OP_LABELS[result.op_type]} · seq ${result.seq}`,
    });
  }
  for (const [index, text] of result.annual_events.entries()) {
    items.push({
      key: `annual-${result.seq}-${index}`, kind: "system", title: `第 ${result.city_year} 年`,
      text, source: "template",
    });
  }
  const anchor = (result.tile?.anchor ?? result.payload.anchor) as [number, number] | undefined;
  return {
    ...store,
    state: {
      ...store.state,
      parcel,
      tiles: result.tiles,
      redeveloped_asset_ids: result.redeveloped_asset_ids,
      metrics: result.metrics,
      city_year: result.city_year,
      last_seq: result.seq,
    },
    needsRecovery,
    pulse: remote && anchor ? { seq: result.seq, anchor } : store.pulse,
    feed: appendFeed(store.feed, items),
  };
}

function feedFromEvent(event: string, data: unknown, eventId: number): FeedItem | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (event === "news") return {
    key: `news-${eventId}`, kind: "news", title: String(value.headline ?? "城市快讯"),
    text: String(value.body ?? ""), source: value.source as "ai" | "template",
  };
  if (event === "citizen") return {
    key: `citizen-${eventId}`, kind: "citizen", title: String(value.persona ?? "市民之声"),
    text: String(value.text ?? ""), source: value.source as "ai" | "template",
  };
  if (event === "mentor") return {
    key: `mentor-${eventId}`, kind: "mentor", title: "规划导师",
    text: String(value.comment ?? ""), source: value.source as "ai" | "template",
  };
  return null;
}

export function cityReducer(store: CityStore, action: CityAction): CityStore {
  switch (action.type) {
    case "reset": return initialCityStore;
    case "connected": return { ...store, connected: action.value };
    case "feed": return { ...store, feed: appendFeed(store.feed, [action.item]) };
    case "report": return { ...store, latestReport: action.report };
    case "snapshot":
      return {
        ...store, state: action.state, needsRecovery: false,
        lastEventId: Math.max(store.lastEventId, action.eventId ?? -1),
      };
    case "operation":
      return applyOperation(store, action.result, action.remote);
    case "sse": {
      if (action.eventId <= store.lastEventId) return store;
      let next = { ...store, lastEventId: action.eventId };
      if (action.event === "snapshot") {
        return cityReducer(next, {
          type: "snapshot", state: action.data as SaveState, eventId: action.eventId,
        });
      }
      if (action.event === "op_applied" || action.event === "city_year") {
        return applyOperation(next, action.data as OperationResult, action.remote ?? true);
      }
      if (action.event === "phase_change" && next.state) {
        const data = action.data as { phase?: string; city_year?: number };
        if (data.phase === "briefing" || data.phase === "building") {
          const cityYear = typeof data.city_year === "number" ? data.city_year : next.state.city_year;
          next = {
            ...next,
            state: {
              ...next.state,
              phase: data.phase,
              city_year: cityYear,
              metrics: { ...next.state.metrics, at_phase: data.phase, at_year: cityYear },
            },
          };
        }
      }
      if (action.event === "report_ready") {
        next = cityReducer(next, { type: "report", report: action.data as ReportResult });
      }
      const item = feedFromEvent(action.event, action.data, action.eventId);
      return item ? { ...next, feed: appendFeed(next.feed, [item]) } : next;
    }
  }
}
