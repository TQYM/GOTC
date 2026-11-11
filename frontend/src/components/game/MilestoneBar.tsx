"use client";

import { useGame } from "@/store/game";

/**
 * 里程碑条（C:S 的人口门槛）：显示当前档位、下一档还差多少人。
 * C:S 里这个信息藏在「里程碑」面板；CITY20 直接放在顶部，因为它决定了
 * 玩家现在能建什么。
 */
export function MilestoneBar() {
  const milestone = useGame((s) => s.milestone);
  if (!milestone) return null;

  const next = milestone.next;
  const percent = Math.round(milestone.progress * 100);

  return (
    <div className="pointer-events-none absolute left-1/2 top-[8.5rem] hidden w-72 -translate-x-1/2 lg:block">
      <div className="rounded-xl border border-white/10 bg-black/50 px-3 py-2 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium text-white/85">
            {milestone.label}
            <span className="ml-1 font-mono text-[10px] text-white/40">
              T{milestone.tier}
            </span>
          </span>
          <span className="font-mono text-[10px] tabular-nums text-white/50">
            {next
              ? `${milestone.population.toLocaleString("zh-CN")} / ${next.population.toLocaleString("zh-CN")}`
              : "已满级"}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        {next ? (
          <div className="mt-1 text-[10px] text-white/45">
            再增加 {Math.max(0, next.population - milestone.population - Math.round(
              (next.population - milestone.population) * milestone.progress,
            )).toLocaleString("zh-CN")} 人解锁 {next.label}
          </div>
        ) : null}
      </div>
    </div>
  );
}
