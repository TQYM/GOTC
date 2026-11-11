"use client";

/**
 * 天气与季节徽标，对标 C:S 的季节/DLC 天气面板。
 *
 * 天气不是装饰：`weather_effects` 会同时改通勤时间、污染与维护费，
 * 所以玩家需要随时知道当前乘数。
 */

import { useGame } from "@/store/game";

const ICONS: Record<string, string> = {
  clear: "☀",
  cloudy: "☁",
  rain: "☂",
  snow: "❄",
  fog: "≡",
};

export function WeatherBadge() {
  const weather = useGame((s) => s.weather);
  if (!weather) return null;

  return (
    <div className="pointer-events-none flex items-center gap-2 rounded-md bg-black/35 px-2.5 py-1 text-xs text-white/85 backdrop-blur">
      <span className="text-sm">{ICONS[weather.kind] ?? "☀"}</span>
      <span>{weather.season_label}</span>
      <span className="opacity-50">·</span>
      <span>{weather.label}</span>
      <span className="opacity-50">·</span>
      <span>{weather.temperature}°C</span>
    </div>
  );
}
