import type {
  OperationResult,
  ProjectionResult,
  ReportResult,
  SaveState,
  TileType,
} from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code = "request_failed") {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("无法连接城市服务，请检查后端后重试", 0, "network_error");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    throw new ApiError(
      error?.message ?? `请求失败（${response.status}）`,
      response.status,
      error?.code,
    );
  }
  return body as T;
}

export function resolveAssetUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function eventsUrl(cityCode: string): string {
  return `${API_BASE}/api/saves/${encodeURIComponent(cityCode)}/events`;
}

export function newClientOpId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const api = {
  create: (name: string, parcelId: "beijing_cbd" | "sandbox") =>
    request<SaveState>("/api/saves", {
      method: "POST",
      body: JSON.stringify({ name: name || undefined, parcel_id: parcelId }),
    }),
  get: (cityCode: string) =>
    request<SaveState>(`/api/saves/${encodeURIComponent(cityCode)}`),
  start: (cityCode: string) =>
    request<SaveState>(`/api/saves/${encodeURIComponent(cityCode)}/start`, {
      method: "POST", body: "{}",
    }),
  operation: (
    cityCode: string,
    operation: OperationResult["op_type"],
    clientOpId: string,
    baseSeq: number,
    payload: Record<string, unknown>,
  ) =>
    request<OperationResult>(
      `/api/saves/${encodeURIComponent(cityCode)}/${operation}`,
      {
        method: "POST",
        body: JSON.stringify({ ...payload, client_op_id: clientOpId, base_seq: baseSeq }),
      },
    ),
  place: (
    cityCode: string, type: TileType, anchor: [number, number],
    clientOpId: string, baseSeq: number, orientation?: "horizontal" | "vertical",
  ) => api.operation(
    cityCode, "place", clientOpId, baseSeq,
    { type, anchor, ...(type === "util_bridge" ? { orientation: orientation ?? "horizontal" } : {}) },
  ),
  project: (cityCode: string, years = 10) =>
    request<ProjectionResult>(`/api/saves/${encodeURIComponent(cityCode)}/project`, {
      method: "POST", body: JSON.stringify({ years }),
    }),
  report: (cityCode: string) =>
    request<ReportResult>(`/api/saves/${encodeURIComponent(cityCode)}/report`, {
      method: "POST", body: "{}",
    }),
  reports: (cityCode: string) =>
    request<{ reports: ReportResult[] }>(`/api/saves/${encodeURIComponent(cityCode)}/reports`),
  mentor: (cityCode: string) =>
    request<{ accepted: true }>(`/api/saves/${encodeURIComponent(cityCode)}/mentor`, {
      method: "POST", body: "{}",
    }),
};
