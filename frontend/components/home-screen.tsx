"use client";

import { FormEvent, useEffect, useState } from "react";
import { loadRecent, normalizeCityCode, validCityCode, type RecentCity } from "../lib/recent";

interface Props {
  busy: string | null;
  error: string | null;
  onCreate: (name: string, parcelId: "beijing_cbd" | "sandbox") => Promise<unknown>;
  onJoin: (code: string) => Promise<unknown>;
  onError: (message: string) => void;
}

export default function HomeScreen({ busy, error, onCreate, onJoin, onError }: Props) {
  const [name, setName] = useState("我的 CBD 更新计划");
  const [parcelId, setParcelId] = useState<"beijing_cbd" | "sandbox">("beijing_cbd");
  const [code, setCode] = useState("");
  const [recent, setRecent] = useState<RecentCity[]>([]);
  useEffect(() => setRecent(loadRecent()), []);

  const create = (event: FormEvent) => {
    event.preventDefault();
    void onCreate(name.trim(), parcelId);
  };
  const join = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeCityCode(code);
    if (!validCityCode(normalized)) {
      onError("城市码应为 8 位字母或数字");
      return;
    }
    void onJoin(normalized);
  };

  return <main className="home-shell">
    <section className="home-hero">
      <div className="brand-mark" aria-hidden="true">城</div>
      <p className="eyebrow">CITY20 · 城市治理沙盘</p>
      <h1>在真实北京，<br /><span>让更新发生。</span></h1>
      <p className="hero-copy">你是城市管理者。守住财政、通勤与宜居的平衡，在朝阳 CBD 的现状肌理中写下下一年。</p>
      <div className="feature-row" aria-label="产品特性">
        <span>真实 OSM 肌理</span><span>确定性年度模拟</span><span>不限时经营</span>
      </div>
    </section>

    <section className="home-actions" aria-label="创建或加入城市">
      <form className="city-card" onSubmit={create}>
        <div className="card-heading"><span className="step">01</span><div><h2>创建城市</h2><p>从真实片区或随机沙盒开始</p></div></div>
        <label>城市名称<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="给这项更新计划命名" /></label>
        <div className="parcel-options" role="radiogroup" aria-label="片区">
          <label className={parcelId === "beijing_cbd" ? "selected" : ""}>
            <input type="radio" name="parcel" value="beijing_cbd" checked={parcelId === "beijing_cbd"} onChange={() => setParcelId("beijing_cbd")} />
            <strong>朝阳 CBD 核心</strong><small>48×48 · 真实建筑与通惠河</small>
          </label>
          <label className={parcelId === "sandbox" ? "selected" : ""}>
            <input type="radio" name="parcel" value="sandbox" checked={parcelId === "sandbox"} onChange={() => setParcelId("sandbox")} />
            <strong>自定义沙盒</strong><small>随机地形 · 从平地建设</small>
          </label>
        </div>
        <button className="primary wide" disabled={busy !== null}>{busy === "create" ? "正在准备城市…" : "创建并进入城市"}</button>
      </form>

      <form className="city-card join-card" onSubmit={join}>
        <div className="card-heading"><span className="step">02</span><div><h2>加入协同规划</h2><p>输入另一端分享的城市码</p></div></div>
        <label>8 位城市码<input className="code-input" value={code} maxLength={8} autoCapitalize="characters" onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="例如 01234567" /></label>
        <button className="secondary wide" disabled={busy !== null}>{busy === "join" ? "正在读取存档…" : "加入城市"}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}

      {recent.length > 0 && <div className="recent-section">
        <h2>最近管理的城市</h2>
        <div className="recent-list">{recent.map((city) => <button key={city.cityCode} onClick={() => void onJoin(city.cityCode)} disabled={busy !== null}>
          <span><strong>{city.name}</strong><small>{city.parcelId === "sandbox" ? "自定义沙盒" : "朝阳 CBD"} · 第 {city.cityYear} 年</small></span><code>{city.cityCode}</code>
        </button>)}</div>
      </div>}
      <details className="data-credit"><summary>数据与许可</summary><p>真实建筑、道路、水系与绿地来自 © OpenStreetMap contributors，按 ODbL 1.0 共享。运行时不请求在线地图或瓦片。</p></details>
    </section>
  </main>;
}
