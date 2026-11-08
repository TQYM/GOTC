"use client";

/**
 * 指标显示（16 §4.4 像素风）：
 * - `ResourcePills`：顶部资源条——5 个核心指标「物品槽」，变化时绿/红两帧闪烁（14 §2.1 简化模式）；
 * - `MetricsDetail`：右侧城市面板里的详细列表（保留人话注解）。
 * testid `metrics-panel` / `metric-*` 保留在胶囊上，供联调与 E2E 使用。
 */
import type { MetricKey, Metrics } from "@/lib/contract";
import { yuan } from "@/lib/api/humanize";
import { useGame } from "@/store/game";
import { PixelIcon } from "@/components/ui/PixelSprite";
import type { IconName } from "@/lib/pixelArt";

export interface CoreMetric {
  key: MetricKey;
  label: string;
  icon: IconName;
  /** 资源槽图标底色 */
  tint: string;
  note: string;
  fmt: (m: Metrics) => string;
  goodUp: boolean;
}

export const CORE_METRICS: CoreMetric[] = [
  {
    key: "funds",
    label: "资金",
    icon: "coin",
    tint: "var(--px-tint-sun)",
    note: "财政余额，别花成负数",
    fmt: (m) => yuan(m.funds),
    goodUp: true,
  },
  {
    key: "population",
    label: "人口",
    icon: "people",
    tint: "var(--px-tint-blue)",
    note: "住进城里的人",
    fmt: (m) => `${m.population.toLocaleString()}`,
    goodUp: true,
  },
  {
    key: "happiness",
    label: "幸福",
    icon: "smile",
    tint: "var(--px-tint-sun)",
    note: "市民满意程度，0–100",
    fmt: (m) => `${m.happiness}`,
    goodUp: true,
  },
  {
    key: "avg_commute",
    label: "通勤",
    icon: "bus",
    tint: "var(--px-tint-blue)",
    note: "平均通勤，越短越好",
    fmt: (m) => `${m.avg_commute}′`,
    goodUp: false,
  },
  {
    key: "green_ratio",
    label: "绿地",
    icon: "leaf",
    tint: "var(--px-tint-mint)",
    note: "新城区宜 ≥30%",
    fmt: (m) => `${Math.round(m.green_ratio * 100)}%`,
    goodUp: true,
  },
];

/** 顶部资源条：一块像素面板里并排 5 个物品槽 */
export function ResourcePills() {
  const metrics = useGame((s) => s.metrics);
  const pulse = useGame((s) => s.pulse);
  if (!metrics) return null;
  return (
    <div
      className="px-panel pointer-events-auto flex max-w-[min(92vw,46rem)] items-center gap-1.5 overflow-x-auto p-1.5 [scrollbar-width:none]"
      data-testid="metrics-panel"
      role="group"
      aria-label="城市资源"
    >
      {CORE_METRICS.map(({ key, label, icon, tint, fmt, goodUp }) => {
        const dir = pulse.dir[key];
        const good = dir ? dir > 0 === goodUp : null;
        return (
          <span key={`${key}:${dir ? pulse.token : 0}`} className="px-slot shrink-0" title={label}>
            <span className="px-slot-icon" style={{ background: tint }}>
              <PixelIcon name={icon} scale={2} />
            </span>
            <span className="flex flex-col gap-0.5 leading-none">
              <span className="text-[11px] text-[var(--px-ink-soft)]">{label}</span>
              <b
                data-testid={`metric-${key}`}
                className={`text-[19px] font-semibold ${
                  good === null ? "" : good ? "metric-pulse-up" : "metric-pulse-down"
                }`}
              >
                {fmt(metrics)}
              </b>
            </span>
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
            className="px-well flex items-center justify-between gap-2 px-2.5 py-1.5"
          >
            <span className="flex items-center gap-1.5 text-xs text-[var(--px-ink-soft)]">
              <PixelIcon name={icon} scale={1} />
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
