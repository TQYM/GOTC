"use client";

import { ENDING_LABELS, SCORE_LABELS } from "../lib/labels";
import type { ReportResult, Scores } from "../lib/types";

function Radar({ scores }: { scores: Scores }) {
  const keys = Object.keys(SCORE_LABELS) as (keyof Scores)[];
  const center = 110;
  const radius = 78;
  const point = (index: number, value: number) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / keys.length;
    const distance = radius * value / 100;
    return `${center + Math.cos(angle) * distance},${center + Math.sin(angle) * distance}`;
  };
  return <svg className="radar" viewBox="0 0 220 220" role="img" aria-label="五维城市体检雷达图">
    {[25, 50, 75, 100].map((value) => <polygon key={value} points={keys.map((_, index) => point(index, value)).join(" ")} fill="none" stroke="currentColor" opacity=".14" />)}
    {keys.map((key, index) => <g key={key}><line x1={center} y1={center} x2={point(index, 100).split(",")[0]} y2={point(index, 100).split(",")[1]} stroke="currentColor" opacity=".14" /><text x={point(index, 122).split(",")[0]} y={point(index, 122).split(",")[1]} textAnchor="middle" dominantBaseline="middle">{SCORE_LABELS[key]} {scores[key]}</text></g>)}
    <polygon points={keys.map((key, index) => point(index, scores[key])).join(" ")} fill="rgba(20,185,129,.28)" stroke="#0d9f70" strokeWidth="3" />
  </svg>;
}

interface Props {
  report: ReportResult;
  history: ReportResult[];
  busy: boolean;
  onSelect: (report: ReportResult) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export default function ReportDialog({ report, history, busy, onSelect, onRefresh, onClose }: Props) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <header><div><p className="eyebrow">CITY HEALTH CHECK · SEQ {report.base_seq}</p><h2 id="report-title">{report.city_name} · 城市体检</h2><p>第 {report.base_year} 年的当前切片，不是终局。关闭后可继续经营。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭城市体检">×</button></header>
      <div className="report-body">
        <div className="report-visual"><span className={`ending-badge ending-${report.ending}`}>{ENDING_LABELS[report.ending]}</span><Radar scores={report.scores} /><p className="source-note">文字来源：{report.report.source === "ai" ? "AI 叙述" : "模板降级"} · 数值始终由 sim 计算</p></div>
        <div className="report-copy"><h3>总体观察</h3><p>{report.report.overview}</p><div className="report-dimensions">{(Object.keys(SCORE_LABELS) as (keyof Scores)[]).map((key) => <article key={key}><h4>{SCORE_LABELS[key]} · {report.scores[key]}</h4><p>{report.report.dimensions[key]}</p></article>)}</div><blockquote>{report.report.ending_story}</blockquote></div>
      </div>
      <footer><div className="report-history"><label>最近体检（最多 20 份）<select aria-label="历史城市体检" value={report.report_id} onChange={(event) => { const selected = history.find((item) => item.report_id === event.target.value); if (selected) onSelect(selected); }}>{history.map((item) => <option key={item.report_id} value={item.report_id}>第 {item.base_year} 年 · {new Date(item.created_at).toLocaleString("zh-CN")}</option>)}</select></label></div><button className="secondary" disabled={busy} onClick={onRefresh}>{busy ? "正在生成…" : "重新体检"}</button><button className="primary" onClick={onClose}>继续经营</button></footer>
    </section>
  </div>;
}
