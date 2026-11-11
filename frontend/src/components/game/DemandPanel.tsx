"use client";

/**
 * RCI 需求条（复刻 C:S 左下角需求面板）。
 *
 * 数值来自后端 `sim_tick` 的 displayed 值 —— 与真正驱动建造的 actual 值
 * 不同步，玩家看到的条会滞后于真实判定（C:S 的 m_*Demand 语义）。
 */

import { useGame } from "@/store/game";

const BARS = [
  { key: "residential", label: "住宅", color: "bg-emerald-400" },
  { key: "commercial", label: "商业", color: "bg-sky-400" },
  { key: "workplace", label: "办公", color: "bg-amber-400" },
] as const;

export default function DemandPanel() {
  const demand = useGame((s) => s.demand);
  const buildsTotal = useGame((s) => s.buildsTotal);

  return (
    <div className="pointer-events-none rounded-xl border border-white/10 bg-black/55 p-2.5 backdrop-blur">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] font-medium tracking-wider text-white/60">
          需求
        </span>
        <span className="font-mono text-[9px] text-white/40">
          已建 {buildsTotal}
        </span>
      </div>
      <div className="flex h-24 items-end gap-2">
        {BARS.map((bar) => {
          const value = Math.max(0, Math.min(100, demand[bar.key]));
          return (
            <div key={bar.key} className="flex flex-col items-center gap-1">
              <div className="relative h-20 w-3.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className={`absolute bottom-0 w-full rounded-full ${bar.color} transition-[height] duration-300`}
                  style={{ height: `${value}%` }}
                />
              </div>
              <span className="text-[9px] leading-none text-white/70">
                {bar.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
