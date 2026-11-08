"use client";

/**
 * 全域地图 HUD（画布外的 DOM）：加载进度 / 失败重试 / 预设导航（全景、CBD、故宫、鸟巢、乡村、西山）。
 */
import { PRESETS, type PresetKey } from "@/lib/map/presets";
import { STAGE_LABEL, type MapState } from "@/lib/map/loader";

const mb = (n?: number) => (n ? `${(n / 1048576).toFixed(1)} MB` : "");

export default function MapHud({
  state,
  retry,
  onPreset,
}: {
  state: MapState;
  retry: () => void;
  onPreset: (key: PresetKey) => void;
}) {
  if (state.status === "loading") {
    const p = state.progress;
    return (
      <div
        role="status"
        data-testid="map-loading"
        className="pointer-events-auto w-72 rounded-xl border border-line bg-bg-elev/95 p-3 text-sm shadow-xl"
      >
        <div className="flex justify-between gap-2">
          <span>{STAGE_LABEL[p.stage]}…</span>
          <span className="tabular-nums">{Math.round(p.ratio * 100)}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded bg-line">
          <div
            className="h-full bg-accent transition-[width]"
            style={{ width: `${Math.round(p.ratio * 100)}%` }}
          />
        </div>
        {p.stage === "download" && p.totalBytes ? (
          <div className="mt-1 text-xs text-fg-muted tabular-nums">
            {mb(p.loadedBytes)} / {mb(p.totalBytes)}
          </div>
        ) : null}
        <p className="mt-1 text-xs text-fg-muted">
          北京全域 154×189km · 73 万格 · 7 万栋建筑；沙盘可先操作。
        </p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div
        role="alert"
        data-testid="map-error"
        className="pointer-events-auto w-72 rounded-xl border border-red-400/60 bg-bg-elev/95 p-3 text-sm shadow-xl"
      >
        <p className="font-semibold">全域地图加载失败</p>
        <p className="mt-1 text-xs text-fg-muted">{state.message}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 min-h-10 rounded-md border border-line px-3 text-xs hover:bg-line"
        >
          重试
        </button>
      </div>
    );
  }
  return (
    <nav
      aria-label="预设导航"
      data-testid="map-presets"
      className="pointer-events-auto flex flex-wrap gap-1.5 rounded-xl bg-bg-elev/90 p-1.5 shadow-lg"
    >
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          data-testid={`preset-${p.key}`}
          onClick={() => onPreset(p.key)}
          className="min-h-10 rounded-md px-2.5 text-xs font-semibold hover:bg-line"
        >
          {p.label}
        </button>
      ))}
    </nav>
  );
}
