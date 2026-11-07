"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { resolveAssetUrl } from "../lib/api";
import { TERRAIN_LABELS, TILE_LABELS } from "../lib/labels";
import type { Anchor, ProjectionResult, ReportResult, TileType, Tool } from "../lib/types";
import { useCity } from "../lib/use-city";
import HomeScreen from "./home-screen";
import MetricsPanel from "./metrics-panel";
import ProjectionPlayer from "./projection-player";
import ReportDialog from "./report-dialog";

const CityScene = dynamic(() => import("./city-scene"), {
  ssr: false,
  loading: () => <div className="scene-loading">正在加载 3D 城市引擎…</div>,
});
const TILE_TYPES = Object.keys(TILE_LABELS) as TileType[];
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "inspect", label: "查看", hint: "查看地块与现状" },
  { id: "place", label: "建设", hint: "选择类型后点击空地" },
  { id: "redevelop", label: "更新", hint: "点击现状建筑，整栋更新" },
  { id: "remove", label: "拆除", hint: "只拆除玩家建设区块" },
];

export default function CityDashboard() {
  const city = useCity();
  const [tool, setTool] = useState<Tool>("inspect");
  const [selectedType, setSelectedType] = useState<TileType>("res_low");
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportResult | null>(null);
  const [reportHistory, setReportHistory] = useState<ReportResult[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const state = city.state;

  const reports = useMemo(() => {
    const latest = city.store.latestReport;
    const all = latest ? [latest, selectedReport, ...reportHistory] : [selectedReport, ...reportHistory];
    const unique = new Map<string, ReportResult>();
    for (const item of all) if (item) unique.set(item.report_id, item);
    return [...unique.values()].slice(0, 20);
  }, [city.store.latestReport, selectedReport, reportHistory]);
  const displayedReport = selectedReport
    ? (city.store.latestReport?.report_id === selectedReport.report_id ? city.store.latestReport : selectedReport)
    : null;

  if (!state) return <HomeScreen
    busy={city.busy} error={city.error}
    onCreate={city.create} onJoin={city.join} onError={city.setError}
  />;

  const cellAction = async (anchor: Anchor) => {
    if (state.phase !== "building") { city.announce("请先开始规划"); return; }
    if (projection) { city.announce("请先关闭只读推演，再操作真实城市"); return; }
    if (tool === "inspect") {
      const terrain = state.parcel.terrain[anchor[0]]?.[anchor[1]];
      city.announce(`坐标 [${anchor.join(", ")}] · ${terrain ? TERRAIN_LABELS[terrain] : "未知地块"}`);
      return;
    }
    if (tool === "place") await city.place(selectedType, anchor, orientation);
    if (tool === "redevelop") {
      const result = await city.operation("redevelop", { anchor });
      if (result?.redevelopment) city.announce(
        `已整栋更新 ${result.redevelopment.asset_id}，扣除 ${result.redevelopment.population_removed} 人 / ${result.redevelopment.jobs_removed} 岗；搬迁阵痛持续至第 ${result.redevelopment.penalty_until_year - 1} 年`,
      );
    }
    if (tool === "remove") {
      const tile = state.tiles.find((item) => item.cells.some(([row, col]) => row === anchor[0] && col === anchor[1]));
      if (!tile) city.announce("这里没有可拆除的玩家区块；现状建筑请使用「更新」");
      else await city.operation("remove", { tile_id: tile.id });
    }
  };

  const openProjection = async () => {
    const result = await city.project(10);
    if (result) { setProjection(result); setTool("inspect"); }
  };
  const openReport = async () => {
    const created = await city.report();
    if (!created) return;
    setSelectedReport(created); setReportOpen(true);
    setReportHistory(await city.reports());
  };
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(state.city_code); city.announce("城市码已复制，可在另一浏览器加入"); }
    catch { city.announce(`请手动复制城市码：${state.city_code}`); }
  };

  return <main className="dashboard-shell">
    <header className="dashboard-header">
      <div className="city-identity"><span className="mini-brand">城</span><div><h1>{state.name}</h1><p>{state.parcel.district_name} · {state.parcel.data_version ?? state.parcel.parcel_id}</p></div></div>
      <div className="year-block"><span>城市年份</span><strong>第 {state.city_year} 年</strong><small>seq {state.last_seq}</small></div>
      <div className="header-actions">
        <span className={`connection ${city.store.connected ? "online" : "offline"}`}><i />{city.store.connected ? "实时同步" : "正在重连"}</span>
        <button className="code-share" onClick={() => void copyCode()} title="复制城市码"><small>城市码</small><code>{state.city_code}</code></button>
        <button className="text-button" onClick={city.leave}>退出</button>
      </div>
    </header>

    <MetricsPanel metrics={state.metrics} />
    {(city.error || city.notice) && <div className={`system-toast ${city.error ? "error" : ""}`} role={city.error ? "alert" : "status"}><span>{city.error ?? city.notice}</span><button onClick={() => { city.setError(null); city.setNotice(null); }} aria-label="关闭提示">×</button></div>}

    <div className="workspace-grid">
      <aside className="tool-sidebar">
        <section><div className="section-title"><h2>规划工具</h2><span>{state.phase === "briefing" ? "简报" : "经营中"}</span></div><div className="tool-tabs">{TOOLS.map((item) => <button key={item.id} className={tool === item.id ? "active" : ""} onClick={() => setTool(item.id)} title={item.hint}>{item.label}</button>)}</div><p className="tool-hint">{TOOLS.find((item) => item.id === tool)?.hint}</p></section>
        {tool === "place" && <section className="palette-section"><h3>区块类型</h3><div className="tile-palette">{TILE_TYPES.map((type) => <button key={type} className={selectedType === type ? "selected" : ""} onClick={() => setSelectedType(type)}><span className={`tile-swatch type-${type}`} />{TILE_LABELS[type]}</button>)}</div>{selectedType === "util_bridge" && <label>桥梁方向<select value={orientation} onChange={(event) => setOrientation(event.target.value as "horizontal" | "vertical")}><option value="horizontal">横向</option><option value="vertical">纵向</option></select></label>}</section>}
        {tool === "redevelop" && <section className="info-card"><h3>城市更新</h3><p>点击灰色现状建筑，按 asset_id 整栋处理。支付拆迁成本，现状人口、岗位与维护费同步扣除；随后可在释放格建设。</p></section>}
        <section className="annual-actions"><h3>经营操作</h3>
          {state.phase === "briefing" ? <button className="primary wide" disabled={city.busy !== null} onClick={() => void city.start()}>{city.busy === "start" ? "正在开启…" : "阅读完毕，开始规划"}</button> : <>
            <button className="primary wide" disabled={city.busy !== null || projection !== null} onClick={() => void city.operation("advance", {})}>{city.busy === "advance" ? "正在结算…" : "推进一年"}</button>
            <button className="secondary wide" disabled={city.busy !== null} onClick={() => void openProjection()}>{city.busy === "project" ? "正在推演…" : "推演未来 10 年"}</button>
            <button className="secondary wide" disabled={city.busy !== null} onClick={() => void openReport()}>{city.busy === "report" ? "正在体检…" : "生成城市体检"}</button>
            <button className="text-button wide" disabled={city.busy !== null} onClick={() => void city.mentor()}>请教规划导师</button>
          </>}
        </section>
      </aside>

      <section className="scene-panel" aria-label="城市三维场景">
        <CityScene
          parcel={state.parcel} tiles={state.tiles}
          redevelopedAssetIds={state.redeveloped_asset_ids}
          buildingsUrl={resolveAssetUrl(state.parcel.buildings_url)}
          networkUrl={resolveAssetUrl(state.parcel.network_url)}
          tool={tool} selectedType={selectedType}
          onCellAction={(anchor) => void cellAction(anchor)}
          pulse={city.store.pulse}
        />
        <div className="scene-legend"><span><i className="legend-existing" />现状建筑</span><span><i className="legend-player" />玩家建设</span><span>拖拽旋转 · 滚轮缩放</span></div>
        {state.parcel.parcel_id === "beijing_cbd" && <div className="scene-credit">© OpenStreetMap contributors · ODbL 1.0</div>}
      </section>

      <aside className="info-sidebar">
        <section className="feed-section"><div className="section-title"><h2>城市信息流</h2><span>{city.store.feed.length} 条</span></div><div className="feed-list" role="log" aria-live="polite">{city.store.feed.length === 0 ? <div className="empty-state"><strong>城市正在运转</strong><p>新闻、市民声音与导师建议会出现在这里。AI 不可用时不影响数值模拟。</p></div> : [...city.store.feed].reverse().map((item) => <article key={item.key} className={`feed-item feed-${item.kind}`}><div><strong>{item.title}</strong>{item.source && <small>{item.source === "ai" ? "AI" : "模板"}</small>}</div><p>{item.text}</p></article>)}</div></section>
        <section className="tiles-section"><div className="section-title"><h2>我的建设</h2><span>{state.tiles.length} 座</span></div>{state.tiles.length === 0 ? <p className="muted">尚无玩家区块。选择「建设」开始，或先更新现状用地。</p> : <ul className="tile-list">{[...state.tiles].reverse().slice(0, 12).map((tile) => <li key={tile.id}><div><strong>{TILE_LABELS[tile.type]}</strong><small>第 {tile.built_at_year} 年 · [{tile.anchor.join(", ")}]</small></div><button aria-label={`拆除 ${TILE_LABELS[tile.type]} ${tile.id}`} disabled={city.busy !== null || projection !== null} onClick={() => void city.operation("remove", { tile_id: tile.id })}>拆除</button></li>)}</ul>}</section>
      </aside>
    </div>

    {projection && <ProjectionPlayer result={projection} onClose={() => setProjection(null)} />}
    {reportOpen && displayedReport && <ReportDialog
      report={displayedReport} history={reports} busy={city.busy === "report"}
      onSelect={setSelectedReport} onRefresh={() => void openReport()}
      onClose={() => setReportOpen(false)}
    />}
  </main>;
}
