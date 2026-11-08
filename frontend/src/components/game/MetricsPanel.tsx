"use client";

/**
 * 指标面板（05 §2.3）：默认简化模式 5 个核心指标 + 人话注解（14 §2.1）；
 * 数值变化 300ms 颜色脉冲（升绿降红）。专业模式（14 指标）随 PR-34。
 */
import type { MetricKey, Metrics } from "@/lib/contract";
import { yuan } from "@/lib/api/humanize";
import { useGame } from "@/store/game";

const CORE: {
  key: MetricKey;
  label: string;
  note: string;
  fmt: (m: Metrics) => string;
  goodUp: boolean;
}[] = [
  {
    key: "population",
    label: "人口",
    note: "住进城里的人",
    fmt: (m) => `${m.population.toLocaleString()} 人`,
    goodUp: true,
  },
  {
    key: "funds",
    label: "资金",
    note: "财政余额，别花成负数",
    fmt: (m) => yuan(m.funds),
    goodUp: true,
  },
  {
    key: "happiness",
    label: "幸福度",
    note: "市民满意程度，0–100",
    fmt: (m) => `${m.happiness}`,
    goodUp: true,
  },
  {
    key: "avg_commute",
    label: "通勤",
    note: "平均通勤，越短越好",
    fmt: (m) => `${m.avg_commute} 分钟`,
    goodUp: false,
  },
  {
    key: "green_ratio",
    label: "绿地率",
    note: "新城区宜 ≥30%",
    fmt: (m) => `${Math.round(m.green_ratio * 100)}%`,
    goodUp: true,
  },
];

export default function MetricsPanel() {
  const metrics = useGame((s) => s.metrics);
  const pulse = useGame((s) => s.pulse);
  const id = useGame((s) => s.id);
  const cityName = useGame((s) => s.cityName);
  const cityYear = useGame((s) => s.cityYear);
  if (!metrics) return null;
  return (
    <div className="flex flex-col gap-2">
      <header className="rounded-lg border border-line bg-bg-elev px-3 py-2">
        <div className="truncate text-sm font-semibold">{cityName ?? "CITY20 城市"}</div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-fg-muted">
          <span>第 {cityYear} 年</span>
          {id && <code data-testid="city-code" title="8 位城市码">{id}</code>}
        </div>
      </header>
      <ul className="flex flex-col gap-2" data-testid="metrics-panel">
      {CORE.map(({ key, label, note, fmt, goodUp }) => {
        const dir = pulse.dir[key];
        const good = dir ? dir > 0 === goodUp : null;
        return (
          <li
            key={`${key}:${dir ? pulse.token : 0}`}
            className="rounded-lg border border-line bg-bg-elev px-3 py-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-fg-muted">{label}</span>
              <span
                data-testid={`metric-${key}`}
                className={`font-semibold tabular-nums ${good === null ? "" : good ? "metric-pulse-up" : "metric-pulse-down"}`}
              >
                {fmt(metrics)}
              </span>
            </div>
            <div className="text-[11px] text-fg-muted">{note}</div>
          </li>
        );
      })}
      </ul>
    </div>
  );
}
