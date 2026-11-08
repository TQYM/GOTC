"use client";

/**
 * 指标显示（WorldBox HUD 重构，PR-37）：
 * - `ResourcePills`：顶部资源条——5 个核心指标胶囊，变化 300ms 绿/红脉冲（14 §2.1 简化模式）；
 * - `MetricsDetail`：右侧城市面板里的详细列表（保留人话注解）。
 * testid `metrics-panel` / `metric-*` 保留在胶囊上，供联调与 E2E 使用。
 */
import type { MetricKey, Metrics } from "@/lib/contract";
import { yuan } from "@/lib/api/humanize";
import { useGame } from "@/store/game";

export interface CoreMetric {
  key: MetricKey;
  label: string;
  icon: string;
  note: string;
  fmt: (m: Metrics) => string;
  goodUp: boolean;
}

export const CORE_METRICS: CoreMetric[] = [
  {
    key: "funds",
    label: "资金",
    icon: "🪙",
    note: "财政余额，别花成负数",
    fmt: (m) => yuan(m.funds),
    goodUp: true,
  },
  {
    key: "population",
    label: "人口",
    icon: "👥",
    note: "住进城里的人",
    fmt: (m) => `${m.population.toLocaleString()}`,
    goodUp: true,
  },
  {
    key: "happiness",
    label: "幸福",
    icon: "😊",
    note: "市民满意程度，0–100",
    fmt: (m) => `${m.happiness}`,
    goodUp: true,
  },
  {
    key: "avg_commute",
    label: "通勤",
    icon: "🚌",
    note: "平均通勤，越短越好",
    fmt: (m) => `${m.avg_commute}′`,
    goodUp: false,
  },
  {
    key: "green_ratio",
    label: "绿地",
    icon: "🌳",
    note: "新城区宜 ≥30%",
    fmt: (m) => `${Math.round(m.green_ratio * 100)}%`,
    goodUp: true,
  },
];

/** 顶部资源胶囊（WorldBox 顶部资源条） */
export function ResourcePills() {
  const metrics = useGame((s) => s.metrics);
  const pulse = useGame((s) => s.pulse);
  if (!metrics) return null;
  return (
    <div
      className="pointer-events-auto flex max-w-[min(92vw,46rem)] items-center gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]"
      data-testid="metrics-panel"
      role="group"
      aria-label="城市资源"
    >
      {CORE_METRICS.map(({ key, label, icon, fmt, goodUp }) => {
        const dir = pulse.dir[key];
        const good = dir ? dir > 0 === goodUp : null;
        return (
          <span
            key={`${key}:${dir ? pulse.token : 0}`}
            className="wb-pill shrink-0 text-sm"
            title={label}
          >
            <span aria-hidden className="text-[0.95rem] leading-none">
              {icon}
            </span>
            <span className="text-[11px] text-[var(--wb-ink-muted)]">{label}</span>
            <b
              data-testid={`metric-${key}`}
              className={`font-bold ${
                good === null ? "" : good ? "metric-pulse-up" : "metric-pulse-down"
              }`}
            >
              {fmt(metrics)}
            </b>
          </span>
        );
      })}
    </div>
  );
}

/** 右侧面板的详细指标（人话注解版） */
export function MetricsDetail() {
  const metrics = useGame((s) => s.metrics);
  const pulse = useGame((s) => s.pulse);
  if (!metrics) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="城市指标详情">
      {CORE_METRICS.map(({ key, label, icon, note, fmt, goodUp }) => {
        const dir = pulse.dir[key];
        const good = dir ? dir > 0 === goodUp : null;
        return (
          <li
            key={`${key}:${dir ? pulse.token : 0}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--wb-gold-line)] bg-black/15 px-2.5 py-1.5"
          >
            <span className="flex items-center gap-1.5 text-xs text-[var(--wb-ink-muted)]">
              <span aria-hidden>{icon}</span>
              {label}
              <span className="hidden text-[10px] opacity-70 sm:inline">· {note}</span>
            </span>
            <b
              className={`text-sm font-bold tabular-nums ${
                good === null ? "" : good ? "metric-pulse-up" : "metric-pulse-down"
              }`}
            >
              {fmt(metrics)}
            </b>
          </li>
        );
      })}
    </ul>
  );
}

export default ResourcePills;
