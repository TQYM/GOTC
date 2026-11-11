"use client";

import { useState } from "react";
import { useGame } from "@/store/game";

/** 城市政策（C:S 的 Policies 面板：全城开关，每条都有成本）。 */
export function PolicyPanel() {
  const policies = useGame((s) => s.policies);
  const setCityPolicy = useGame((s) => s.setCityPolicy);
  const [open, setOpen] = useState(false);

  const active = policies.filter((p) => p.enabled).length;

  return (
    <div className="pointer-events-auto w-72 rounded-xl border border-white/10 bg-black/55 backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-[11px] font-medium tracking-wide text-white/85">城市政策</span>
        <span className="font-mono text-[10px] text-white/45">
          {active}/{policies.length} {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="space-y-1.5 border-t border-white/10 px-3 py-2">
          {policies.map((policy) => (
            <button
              key={policy.key}
              type="button"
              onClick={() => void setCityPolicy(policy.key, !policy.enabled)}
              className={`w-full rounded-lg border px-2 py-1.5 text-left transition ${
                policy.enabled
                  ? "border-emerald-400/40 bg-emerald-500/15"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <div className="text-[11px] text-white/85">{policy.label}</div>
              <div className="text-[10px] leading-tight text-white/45">{policy.hint}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
