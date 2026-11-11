"use client";

import { useMemo, useState } from "react";

import { useGame } from "@/store/game";

/**
 * 公共交通线路面板（C:S 的 TransportLine 管理）。
 *
 * C:S 的玩家动线：画线 → 加站 → 看客流 → 调票价 → 删线。
 * 这里把「画线」简化为「在地图上依次点站点」：先选制式，再勾选已有地铁站，
 * 最后「建线」。线路本身不产生客流，只有住宅与岗位都在站点 600m 内才会
 * 被通勤者使用（后端 `TransitManager.best_transit_minutes`）。
 */
const KIND_LABEL: Record<"bus" | "metro", string> = { bus: "公交", metro: "地铁" };
const KIND_PRICE_CAP: Record<"bus" | "metro", number> = { bus: 3, metro: 6 };

export function TransitPanel() {
  const transit = useGame((s) => s.transit);
  const coverage = useGame((s) => s.transitCoverage);
  const open = useGame((s) => s.transitPanelOpen);
  const toggle = useGame((s) => s.toggleTransitPanel);
  const createLine = useGame((s) => s.createTransitLine);
  const deleteLine = useGame((s) => s.deleteTransitLine);
  const setPrice = useGame((s) => s.setTransitPrice);
  const tiles = useGame((s) => s.tiles);

  const [kind, setKind] = useState<"bus" | "metro">("bus");
  const [picked, setPicked] = useState<string[]>([]);

  const stations = useMemo(
    () => tiles.filter((t) => t.type === "trans_metro").map((t) => t.id),
    [tiles],
  );

  const toggleStation = (id: string) => {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="pointer-events-auto w-72 rounded-xl border border-white/10 bg-slate-900/85 text-xs text-slate-100 shadow-xl backdrop-blur">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="font-semibold">公共交通</span>
        <span className="text-slate-400">
          {transit.length} 条 · 覆盖 {Math.round(coverage * 100)}%
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-white/10 px-3 py-2">
          <div className="flex gap-1">
            {(["bus", "metro"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setKind(item)}
                className={`flex-1 rounded px-2 py-1 ${
                  kind === item ? "bg-sky-500/80" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                {KIND_LABEL[item]}
              </button>
            ))}
          </div>

          <div className="max-h-24 space-y-1 overflow-y-auto rounded bg-black/20 p-1">
            {stations.length === 0 && (
              <p className="px-1 py-1 text-slate-400">先在地图上放「地铁站」地块</p>
            )}
            {stations.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleStation(id)}
                className={`block w-full rounded px-1 py-0.5 text-left ${
                  picked.includes(id) ? "bg-emerald-500/70" : "hover:bg-white/10"
                }`}
              >
                {id}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={picked.length < 2}
            onClick={async () => {
              await createLine(kind, picked);
              setPicked([]);
            }}
            className="w-full rounded bg-sky-600 px-2 py-1 font-medium disabled:opacity-40"
          >
            建线（已选 {picked.length} 站）
          </button>

          <div className="space-y-1">
            {transit.map((line) => (
              <div key={line.lid} className="rounded bg-black/20 px-2 py-1">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: line.color }}
                    />
                    {line.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteLine(line.lid)}
                    className="text-rose-300 hover:text-rose-200"
                  >
                    拆
                  </button>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    {KIND_LABEL[line.kind]} · {line.stops_count} 站
                  </span>
                  <label className="flex items-center gap-1">
                    票价
                    <input
                      type="range"
                      min={0}
                      max={KIND_PRICE_CAP[line.kind]}
                      step={0.5}
                      value={line.price}
                      onChange={(event) =>
                        setPrice(line.lid, Number(event.target.value))
                      }
                      className="w-14"
                    />
                    <span className="w-5 text-right">{line.price}</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
