"use client";

/**
 * 速度与时钟控制（复刻 C:S 顶部时间条）。
 *
 * 速度档与 C:S 一致：暂停 / 1x / 2x / 3x —— 其中 3x 档实际跑 4 帧，
 * 这是 C:S 的真实行为，不是 bug（`SimulationManager.FinalSimulationSpeed`）。
 */

import { useGame } from "@/store/game";

const SPEEDS = [
  { value: 0 as const, label: "❚❚", hint: "暂停" },
  { value: 1 as const, label: "▶", hint: "1x" },
  { value: 2 as const, label: "▶▶", hint: "2x" },
  { value: 3 as const, label: "▶▶▶", hint: "3x" },
];

const FRAMES_PER_DAY = 10;
const FRAMES_PER_YEAR = 3600;

export default function SpeedControl() {
  const speed = useGame((s) => s.speed);
  const simFrame = useGame((s) => s.simFrame);
  const cityYear = useGame((s) => s.cityYear);
  const setSpeed = useGame((s) => s.setSpeed);
  const weather = useGame((s) => s.weather);

  const day = Math.floor(simFrame / FRAMES_PER_DAY) + 1;
  const hour = Math.floor(((simFrame % FRAMES_PER_DAY) / FRAMES_PER_DAY) * 24);
  const yearProgress = (simFrame % FRAMES_PER_YEAR) / FRAMES_PER_YEAR;

  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur">
      <div className="flex flex-col gap-0.5">
        <div className="font-mono text-[11px] tabular-nums text-white/85">
          {cityYear} 年 · 第 {day} 天 · {String(hour).padStart(2, "0")}:00
        </div>
        {weather ? (
          <div className="font-mono text-[10px] tabular-nums text-white/50">
            {weather.season_label} · {weather.label} {weather.temperature}°C
          </div>
        ) : null}
        <div className="h-0.5 w-32 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-emerald-400/80"
            style={{ width: `${Math.round(yearProgress * 100)}%` }}
          />
        </div>
      </div>
      <div className="flex gap-1">
        {SPEEDS.map((item) => {
          const active = speed === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => void setSpeed(item.value)}
              title={item.hint}
              aria-label={item.hint}
              aria-pressed={active}
              className={`rounded-md px-2 py-1 text-[11px] leading-none transition ${
                active
                  ? "bg-emerald-400 text-black"
                  : "bg-white/10 text-white/80 hover:bg-white/20"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
