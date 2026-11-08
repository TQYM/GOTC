import type { SaveState } from "./types";

const STORAGE_KEY = "city20.recent.v2";

export interface RecentCity {
  cityCode: string;
  name: string;
  parcelId: string;
  cityYear: number;
  visitedAt: number;
}

export function loadRecent(storage: Pick<Storage, "getItem"> = localStorage): RecentCity[] {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RecentCity =>
      item && typeof item.cityCode === "string" && /^[A-Z0-9]{8}$/.test(item.cityCode),
    ).slice(0, 8);
  } catch {
    return [];
  }
}

export interface RecentCityInput {
  cityCode: string;
  name: string;
  parcelId: string;
  cityYear: number;
}

export function rememberRecent(
  input: RecentCityInput,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): RecentCity[] {
  const next: RecentCity = { ...input, visitedAt: Date.now() };
  const recent = [next, ...loadRecent(storage).filter((item) => item.cityCode !== next.cityCode)].slice(0, 8);
  try { storage.setItem(STORAGE_KEY, JSON.stringify(recent)); } catch { /* 隐私模式下仍可使用当前页 */ }
  return recent;
}

export function rememberCity(
  state: SaveState,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): RecentCity[] {
  return rememberRecent({
    cityCode: state.city_code,
    name: state.name,
    parcelId: state.parcel.parcel_id ?? "sandbox",
    cityYear: state.city_year,
  }, storage);
}

export function normalizeCityCode(value: string): string {
  return value.trim().toUpperCase();
}

export function validCityCode(value: string): boolean {
  return /^[A-Z0-9]{8}$/.test(normalizeCityCode(value));
}
