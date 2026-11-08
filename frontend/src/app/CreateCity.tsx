"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { pickApi, ApiError } from "@/lib/api";
import { humanizeError } from "@/lib/api/humanize";
import {
  loadRecent,
  normalizeCityCode,
  validCityCode,
  type RecentCity,
} from "@saves/lib/recent";

export default function CreateCity() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [parcelId, setParcelId] = useState<"beijing_core" | "beijing_cbd" | "sandbox">("beijing_core");
  const [seed, setSeed] = useState("");
  const [code, setCode] = useState("");
  const [recent, setRecent] = useState<RecentCity[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setRecent(loadRecent()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const go = async (mock: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const api = pickApi(new URLSearchParams(mock ? "mock=1" : ""));
      const value = seed.trim() ? Number(seed.trim()) : undefined;
      const { id } = await api.create(mock ? undefined : {
        name: name.trim() || undefined,
        parcelId,
        ...(parcelId === "sandbox" && Number.isFinite(value) ? { seed: value } : {}),
      });
      router.push(`/game?session=${encodeURIComponent(id)}${mock ? "&mock=1" : ""}`);
    } catch (e) {
      setErr(e instanceof ApiError ? humanizeError(e).title : "创建失败，请稍后重试");
      setBusy(false);
    }
  };

  const join = () => {
    const normalized = normalizeCityCode(code);
    if (!validCityCode(normalized)) {
      setErr("城市码应为 8 位字母或数字");
      return;
    }
    router.push(`/game?session=${normalized}`);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">
          城市名称（可选）
          <input
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="我的更新计划"
            className="min-h-11 rounded-xl border border-[var(--wb-gold-line)] bg-black/25 px-3 text-[var(--wb-ink)] placeholder:text-[var(--wb-ink-muted)] focus:outline-none focus:border-[var(--wb-gold)]"
          />
        </label>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="parcel"
              data-testid="parcel-core"
              checked={parcelId === "beijing_core"}
              onChange={() => setParcelId("beijing_core")}
            />
            东西朝海 · 全域 48km
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="parcel"
              data-testid="parcel-cbd"
              checked={parcelId === "beijing_cbd"}
              onChange={() => setParcelId("beijing_cbd")}
            />
            朝阳 CBD · 精细 2.4km
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="parcel"
              data-testid="parcel-sandbox"
              checked={parcelId === "sandbox"}
              onChange={() => setParcelId("sandbox")}
            />
            确定性练习沙盒
          </label>
        </div>
        {parcelId === "sandbox" && (
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="种子（可选，复现同款地块）"
            inputMode="numeric"
            className="min-h-11 rounded-xl border border-[var(--wb-gold-line)] bg-black/25 px-3 text-[var(--wb-ink)] placeholder:text-[var(--wb-ink-muted)] focus:outline-none focus:border-[var(--wb-gold)]"
            aria-label="种子"
          />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="create-city"
            disabled={busy}
            onClick={() => void go(false)}
            className="min-h-12 rounded-full bg-[var(--wb-gold)] px-6 font-bold text-[#1c1610] transition-transform duration-150 active:scale-[0.97] disabled:opacity-60"
          >
            {busy ? "正在创建…" : "创建新城"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void go(true)}
            className="min-h-12 rounded-full border border-[var(--wb-gold-line)] px-5 text-sm text-[var(--wb-ink)] hover:bg-white/5 disabled:opacity-60"
          >
            离线演示（不连后端）
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={code}
          onChange={(e) => setCode(normalizeCityCode(e.target.value).slice(0, 8))}
          onKeyDown={(e) => { if (e.key === "Enter") join(); }}
          placeholder="输入 8 位城市码继续经营"
          className="min-h-11 min-w-56 flex-1 rounded-xl border border-[var(--wb-gold-line)] bg-black/25 px-3 font-mono tracking-widest text-[var(--wb-ink)] placeholder:font-sans placeholder:tracking-normal placeholder:text-[var(--wb-ink-muted)] focus:outline-none focus:border-[var(--wb-gold)]"
          aria-label="城市码"
        />
        <button type="button" data-testid="join-city" onClick={join} className="min-h-11 rounded-full border border-[var(--wb-gold-line)] px-5 font-semibold text-[var(--wb-ink)] hover:bg-white/5">
          加入城市
        </button>
      </div>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      {recent.length > 0 && (
        <section aria-label="最近城市" className="grid gap-1">
          <h2 className="text-xs font-semibold tracking-wide text-[var(--wb-ink-muted)]">最近经营</h2>
          {recent.map((item) => (
            <button
              key={item.cityCode}
              type="button"
              onClick={() => router.push(`/game?session=${item.cityCode}`)}
              className="flex min-h-11 items-center justify-between rounded-lg px-2 text-left text-sm text-[var(--wb-ink)] hover:bg-white/5"
            >
              <span>{item.name} · 第 {item.cityYear} 年</span>
              <code>{item.cityCode}</code>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
