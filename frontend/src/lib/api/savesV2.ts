import type { PlaceResult } from "@/lib/contract";
import type {
  OperationResult,
  ProjectionResult,
  ReportResult,
  SaveState,
} from "@/lib/contractV2";
import { openEventStream } from "@/lib/sse";
import { request } from "./http";
import type {
  CityApi,
  CitySnapshot,
  CreateCityInput,
  StreamEvent,
} from "./cityApi";

const base = (id: string) => `/api/saves/${encodeURIComponent(id)}`;

function clientOpId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function snapshot(s: SaveState): CitySnapshot {
  return {
    id: s.city_code,
    name: s.name,
    parcel: s.parcel,
    tiles: s.tiles,
    redevelopedAssetIds: s.redeveloped_asset_ids,
    metrics: s.metrics,
    phase: s.phase,
    cityYear: s.city_year,
    lastSeq: s.last_seq,
    projection: [],
    projectionPublishedYear: 0,
    scores: null,
    ending: null,
    report: null,
    cityName: s.name,
  };
}

export function createSavesV2Api(): CityApi {
  const retryIds = new Map<string, string>();
  const ownOps = new Set<string>();
  const sequences = new Map<string, number>();

  const applySeq = (id: string, seq: number) => {
    sequences.set(id, Math.max(sequences.get(id) ?? 0, seq));
  };
  const load = async (id: string) => {
    const state = await request<SaveState>("GET", base(id));
    applySeq(id, state.last_seq);
    return snapshot(state);
  };
  const operation = async (
    id: string,
    op: OperationResult["op_type"],
    payload: Record<string, unknown>,
  ): Promise<OperationResult> => {
    const key = `${id}:${op}:${JSON.stringify(payload)}`;
    const idempotencyKey = retryIds.get(key) ?? clientOpId();
    retryIds.set(key, idempotencyKey);
    // SSE 可以早于 HTTP 响应，必须先登记再发请求。
    ownOps.add(idempotencyKey);
    try {
      const result = await request<OperationResult>("POST", `${base(id)}/${op}`, {
        ...payload,
        client_op_id: idempotencyKey,
        base_seq: sequences.get(id) ?? 0,
      });
      applySeq(id, result.seq);
      retryIds.delete(key);
      return result;
    } catch (error) {
      // 只有明确的新用户意图才换 key；同一重试继续复用。
      throw error;
    }
  };

  return {
    kind: "v2",
    capabilities: {
      advanceYear: true,
      project: true,
      report: true,
      projectLocksCity: false,
      redevelop: true,
      reportHistory: true,
      mentor: true,
    },

    async create(input?: number | CreateCityInput) {
      const options: CreateCityInput = typeof input === "number" ? { seed: input, parcelId: "sandbox" } : input ?? {};
      const parcelId = options.parcelId ?? "beijing_cbd";
      const state = await request<SaveState>("POST", "/api/saves", {
        name: options.name || undefined,
        parcel_id: parcelId,
        ...(parcelId === "sandbox" && options.seed !== undefined ? { seed: options.seed } : {}),
      });
      applySeq(state.city_code, state.last_seq);
      return { id: state.city_code };
    },

    load,

    async startPlanning(id) {
      const state = await request<SaveState>("POST", `${base(id)}/start`, {});
      applySeq(id, state.last_seq);
      return { phase: state.phase, snapshot: snapshot(state) };
    },

    async place(id, input) {
      const result = await operation(id, "place", { ...input });
      if (!result.tile) throw new Error("place 响应缺少 tile");
      return { ...result, tile: result.tile } as PlaceResult;
    },

    async remove(id, tileId) {
      const result = await operation(id, "remove", { tile_id: tileId });
      if (!result.tile) throw new Error("remove 响应缺少被拆除 tile");
      return { ...result, tile: result.tile } as PlaceResult;
    },

    redevelop(id, anchor) {
      return operation(id, "redevelop", { anchor });
    },

    async advanceYear(id) {
      const result = await operation(id, "advance", {});
      return { cityYear: result.city_year, metrics: result.metrics, phase: "building", operation: result };
    },

    async project(id) {
      const result = await request<ProjectionResult>("POST", `${base(id)}/project`, { years: 10 });
      return {
        phase: "projecting",
        projection: result.projection,
        projectionId: result.projection_id,
        baseYear: result.base_year,
        baseSeq: result.base_seq,
      };
    },

    async report(id) {
      const result = await request<ReportResult>("POST", `${base(id)}/report`, {});
      return {
        phase: "report",
        scores: result.scores,
        ending: result.ending,
        report: result.report,
        cityName: result.city_name,
        result,
      };
    },

    async reports(id) {
      return (await request<{ reports: ReportResult[] }>("GET", `${base(id)}/reports`)).reports;
    },

    async mentor(id) {
      await request<{ accepted: true }>("POST", `${base(id)}/mentor`, {});
    },

    // v2 没有 backToBuilding REST；仅由 store 切换本端视图。
    async backToBuilding() {
      return { phase: "building" };
    },

    subscribe(id, handlers) {
      return openEventStream(`${base(id)}/events`, {
        onConn: handlers.onConn,
        onEvent: (event) => {
          if (event.event === "snapshot") {
            const state = event.data as unknown as SaveState;
            applySeq(id, state.last_seq);
            handlers.onEvent({ ...event, data: snapshot(state) });
            return;
          }
          if (event.event === "op_applied") {
            const result = event.data;
            applySeq(id, result.seq);
            if (ownOps.has(result.client_op_id)) return;
          }
          handlers.onEvent(event as StreamEvent);
        },
      });
    },
  };
}

export const savesV2 = createSavesV2Api();
