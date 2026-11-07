"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "../lib/labels";
import type { ProjectionResult } from "../lib/types";

export default function ProjectionPlayer({ result, onClose }: { result: ProjectionResult; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const step = result.projection[index];
  useEffect(() => {
    if (!playing) return;
    if (index >= result.projection.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setIndex((value) => value + 1), 1200);
    return () => window.clearTimeout(timer);
  }, [playing, index, result.projection.length]);
  if (!step) return null;

  return <section className="projection-panel" aria-label="只读推演播放器">
    <div className="projection-heading"><div><p className="eyebrow">READ-ONLY PROJECTION</p><h2>第 {step.year} 年 · 只读推演</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭推演">×</button></div>
    <p className="projection-base">基准：第 {result.base_year} 年 / seq {result.base_seq}。这里不会写入存档。</p>
    <div className="projection-metrics">
      <span>资金 <strong>¥ {formatMoney(step.metrics.funds)}</strong></span>
      <span>人口 <strong>{formatMoney(step.metrics.population)}</strong></span>
      <span>岗位 <strong>{formatMoney(step.metrics.jobs)}</strong></span>
      <span>幸福 <strong>{step.metrics.happiness.toFixed(0)}</strong></span>
    </div>
    {step.events.length > 0 && <ul className="projection-events">{step.events.map((event) => <li key={event}>{event}</li>)}</ul>}
    <div className="projection-controls">
      <button className="secondary" disabled={index === 0} onClick={() => { setPlaying(false); setIndex((value) => value - 1); }}>上一年</button>
      <button className="primary" onClick={() => {
        if (!playing && index === result.projection.length - 1) setIndex(0);
        setPlaying((value) => !value);
      }}>{playing ? "暂停" : index === result.projection.length - 1 ? "从头播放" : "播放"}</button>
      <button className="secondary" disabled={index === result.projection.length - 1} onClick={() => { setPlaying(false); setIndex((value) => value + 1); }}>下一年</button>
    </div>
    <div className="projection-track" aria-label={`推演进度 ${index + 1}/${result.projection.length}`}>{result.projection.map((item, itemIndex) => <button key={item.year} className={itemIndex === index ? "active" : ""} onClick={() => { setPlaying(false); setIndex(itemIndex); }} aria-label={`查看第 ${item.year} 年`} />)}</div>
    <button className="text-button" onClick={onClose}>返回真实城市，继续经营</button>
  </section>;
}
