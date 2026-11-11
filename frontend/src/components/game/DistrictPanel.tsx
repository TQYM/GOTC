"use client";

import { useGame } from "@/store/game";

const POLICY_LABELS: Record<string, string> = {
  tax_raise: "高税率 +2%",
  tax_lower: "低税率 -2%",
  no_heavy_industry: "限制重工业",
  green: "绿色城区",
  education_boost: "教育优先",
  industry_boost: "工业扶持",
};

export function DistrictPanel() {
  const districts = useGame((s) => s.districts);
  const open = useGame((s) => s.districtPanelOpen);
  const toggle = useGame((s) => s.toggleDistrictPanel);
  const setPolicy = useGame((s) => s.setDistrictPolicy);

  if (districts.length === 0) return null;

  return (
    <div className="pointer-events-auto w-72 rounded-xl border border-white/10 bg-slate-900/85 text-slate-100 shadow-xl backdrop-blur">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium"
      >
        <span>行政区 {districts.length}</span>
        <span className="text-slate-400">{open ? "收起" : "展开"}</span>
      </button>
      {open ? (
        <div className="max-h-64 space-y-2 overflow-y-auto border-t border-white/10 px-3 py-2 text-[11px]">
          {districts.map((district) => (
            <div key={district.did} className="rounded border border-white/10 p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{district.name}</span>
                <span className="text-slate-500">{district.tiles.length} 地块</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(POLICY_LABELS).map(([policy, label]) => {
                  const on = district.policies.includes(policy);
                  return (
                    <button
                      key={policy}
                      type="button"
                      onClick={() => void setPolicy(district.did, policy, !on)}
                      className={
                        "rounded px-1.5 py-0.5 text-[10px] " +
                        (on
                          ? "bg-emerald-500/80 text-white"
                          : "bg-slate-700/70 text-slate-300 hover:bg-slate-600")
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
