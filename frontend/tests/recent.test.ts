import { describe, expect, it } from "vitest";
import { loadRecent, normalizeCityCode, rememberCity, validCityCode } from "../lib/recent";
import { makeState } from "./fixtures";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("最近城市", () => {
  it("去重并限制最近 8 个", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 10; index += 1) {
      rememberCity(makeState({ city_code: `CITY${String(index).padStart(4, "0")}` }), storage);
    }
    rememberCity(makeState({ city_code: "CITY0005", name: "再次访问" }), storage);
    const recent = loadRecent(storage);
    expect(recent).toHaveLength(8);
    expect(recent[0]).toMatchObject({ cityCode: "CITY0005", name: "再次访问" });
  });

  it("损坏数据安全降级，城市码统一大写", () => {
    const storage = memoryStorage();
    storage.setItem("city20.recent.v2", "not-json");
    expect(loadRecent(storage)).toEqual([]);
    expect(normalizeCityCode(" abcd1234 ")).toBe("ABCD1234");
    expect(validCityCode("abcd1234")).toBe(true);
    expect(validCityCode("123")).toBe(false);
  });
});
