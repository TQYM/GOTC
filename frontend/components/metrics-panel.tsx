import { formatMoney } from "../lib/labels";
import type { Metrics } from "../lib/types";

export default function MetricsPanel({ metrics }: { metrics: Metrics }) {
  const primary = [
    ["可用资金", `¥ ${formatMoney(metrics.funds)}`],
    ["常住人口", `${formatMoney(metrics.population)} 人`],
    ["就业岗位", `${formatMoney(metrics.jobs)} 岗`],
    ["幸福指数", `${metrics.happiness.toFixed(0)} / 100`],
  ];
  return <section className="metrics-panel" aria-label="城市实时指标">
    <div className="primary-metrics">{primary.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <details className="all-metrics"><summary>查看全部 14 项指标</summary><dl>
      <div><dt>职住比</dt><dd>{metrics.job_res_ratio.toFixed(2)}</dd></div>
      <div><dt>地价指数</dt><dd>{metrics.land_price_index.toFixed(1)}</dd></div>
      <div><dt>绿化率</dt><dd>{(metrics.green_ratio * 100).toFixed(1)}%</dd></div>
      <div><dt>平均通勤</dt><dd>{metrics.avg_commute.toFixed(1)} 分钟</dd></div>
      <div><dt>拥堵指数</dt><dd>{metrics.congestion.toFixed(2)}</dd></div>
      <div><dt>污染指数</dt><dd>{metrics.pollution.toFixed(1)}</dd></div>
      <div><dt>年税收</dt><dd>¥ {formatMoney(metrics.tax_income)}</dd></div>
      <div><dt>年维护</dt><dd>¥ {formatMoney(metrics.upkeep)}</dd></div>
      <div><dt>教育覆盖</dt><dd>{(metrics.coverage_edu * 100).toFixed(1)}%</dd></div>
      <div><dt>医疗覆盖</dt><dd>{(metrics.coverage_med * 100).toFixed(1)}%</dd></div>
    </dl></details>
  </section>;
}
