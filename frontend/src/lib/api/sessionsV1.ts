/**
 * v1 适配器：对接当前后端 `/api/sessions/*`（02 正文 §3）。
 * 后端迁到 v2 saves（10 §5，PR-23）后，新增 savesV2 适配器替换本文件，页面与 store 不动。
 */
import type {
  AdvanceResult,
  FinalizeResult,
  PlaceResult,
  SessionCreated,
  SessionState,
} from "@/lib/contract";
import { openEventStream } from "@/lib/sse";
import { request } from "./http";
import {
  toGamePhase,
  UnsupportedError,
  type CityApi,
  type CitySnapshot,
} from "./cityApi";

const base = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

function snapshot(s: SessionState): CitySnapshot {
  return {
    id: s.session_id,
    parcel: s.parcel,
    tiles: s.tiles,
    redevelopedAssetIds: [],
    metrics: s.metrics,
    phase: toGamePhase(s.phase),
    cityYear: s.metrics.at_year,
    lastSeq: 0,
    projection: s.projection ?? [],
    projectionPublishedYear: s.projection_published_year ?? 0,
    scores: s.scores ?? null,
    ending: s.ending ?? null,
    report: s.report ?? null,
    cityName: s.city_name ?? null,
  };
}

export const sessionsV1: CityApi = {
  kind: "v1",
  capabilities: {
    advanceYear: false,
    project: true,
    report: false,
    projectLocksCity: true,
  },

  async create(seed) {
    const value = typeof seed === "number" ? seed : seed?.seed;
    const r = await request<SessionCreated>(
      "POST",
      "/api/sessions",
      value === undefined ? {} : { seed: value },
    );
    return { id: r.session_id };
  },

  async load(id) {
    return snapshot(await request<SessionState>("GET", base(id)));
  },

  async startPlanning(id) {
    await request<AdvanceResult>("POST", `${base(id)}/advance`);
    return { phase: "building" };
  },

  place(id, input) {
    return request<PlaceResult>("POST", `${base(id)}/place`, input);
  },

  remove(id, tileId) {
    return request<PlaceResult>("POST", `${base(id)}/remove`, {
      tile_id: tileId,
    });
  },

  async advanceYear() {
    throw new UnsupportedError("快进一年");
  },

  async project(id) {
    const r = await request<FinalizeResult>("POST", `${base(id)}/finalize`);
    return { phase: toGamePhase(r.phase), projection: r.projection, final: r };
  },

  async report() {
    throw new UnsupportedError("单独生成报告");
  },

  async backToBuilding() {
    throw new UnsupportedError("返回建设");
  },

  subscribe(id, handlers) {
    return openEventStream(`${base(id)}/stream`, handlers);
  },
};
