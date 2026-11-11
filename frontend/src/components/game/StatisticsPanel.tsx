"use client";

import { useMemo, useState } from "react";
import { useGame } from "@/store/game";

/** 单条折线：把一串数值映射到 SVG 路径。 */
function sparkline(values: number[], width: number, height: number, color: string) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <polyline
      points={points.join(" ")}
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

function MetricRow({
  label,
  value,
  series,
  color,
}: {
  label: string;
  value: string;
  series: number[];
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 shrink-0 text-[11px] text-white/60">{label}</div>
      <svg viewBox="0 0 96 24" className="h-6 w-24 overflow-visible">
        {sparkline(series, 96, 24, color)}
      </svg>
      <div className="ml-auto font-mono text-[11px] tabular-nums text-white/85">{value}</div>
    </div>
  );
}

/** 统计面板（C:S 的 StatisticsManager：逐年回看城市怎么长大）。 */
export function StatisticsPanel() {
  const history = useGame((s) => s.history);
  const [open, setOpen] = useState(false);

  const series = useMemo(() => {
    const tail = history.slice(-24);
    return {
      population: tail.map((p) => p.population),
      jobs: tail.map((p) => p.jobs),
      funds: tail.map((p) => p.funds),
      happiness: tail.map((p) => p.happiness),
    };
  }, [history]);

  const last = history.at(-1);

  return (
    <div className="pointer-events-auto w-72 rounded-xl border border-white/10 bg-black/55 backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-[11px] font-medium tracking-wide text-white/85">统计</span>
        <span className="font-mono text-[10px] text-white/45">
          {last ? `${last.year} 年` : "暂无数据"} {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="space-y-1.5 border-t border-white/10 px-3 py-2">
          <MetricRow
            label="人口"
            value={last ? last.population.toLocaleString("zh-CN") : "—"}
            series={series.population}
            color="#34D399"
          />
          <MetricRow
            label="岗位"
            value={last ? last.jobs.toLocaleString("zh-CN") : "—"}
            series={series.jobs}
            color="#60A5FA"
          />
          <MetricRow
            label="资金"
            value={last ? `¥${Math.round(last.funds / 10_000).toLocaleString("zh-CN")}万` : "—"}
            series={series.funds}
            color="#FBBF24"
          />
          <MetricRow
            label="幸福"
            value={last ? `${last.happiness}` : "—"}
            series={series.happiness}
            color="#F472B6"
          />
          <div className="pt-1 text-[10px] leading-relaxed text-white/40">
            每年结算时记一笔，最多保留 60 年。
          </div>
        </div>
      ) : null}
    </div>
  );
}
