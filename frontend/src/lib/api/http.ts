/**
 * REST 请求封装（02 §1 错误协议）：统一把错误信封解析成 ApiError。
 * 网络层失败（断网、反代不可达）记为 code="network"，前端 toast + 一键重试，不自动重试（05 §3.3）。
 */
import type { ErrorEnvelope } from "@/lib/contract";
import { withBase } from "./base";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withBase(path), {
      method,
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    throw new ApiError(
      0,
      "network",
      e instanceof Error ? e.message : "网络错误",
    );
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const env = json as Partial<ErrorEnvelope> | null;
    if (env?.error?.code) {
      throw new ApiError(
        res.status,
        env.error.code,
        env.error.message,
        env.error.details ?? {},
      );
    }
    throw new ApiError(
      res.status,
      res.status >= 500 ? "internal_error" : "network",
      `HTTP ${res.status}`,
    );
  }
  return json as T;
}
