import type { CityApi } from "./cityApi";
import { mockApi } from "./mockApi";
import { sessionsV1 } from "./sessionsV1";

export * from "./cityApi";
export { ApiError } from "./http";

/** `?mock=1` 或 NEXT_PUBLIC_USE_MOCK=1 时使用浏览器内 mock（02 §0.2 mock 开关），否则连真后端 */
export function pickApi(search?: URLSearchParams | null): CityApi {
  if (search?.get("mock") === "1" || process.env.NEXT_PUBLIC_USE_MOCK === "1")
    return mockApi;
  return sessionsV1;
}
