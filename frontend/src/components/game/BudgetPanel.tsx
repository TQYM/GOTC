"use client";

/**
 * 财政面板：对齐 Cities: Skylines 的「预算」页。
 *
 * C:S 的 EconomyManager 里，资金不是一次性年度结算，而是每 256 帧按 16 个
 * 日分段落账、每日结算、每月还贷。这里展示同一组量：资金、当日收支、
 * 负债、五类服务税率。
 */

import { useState } from "react";

import { useGame } from "@/store/game";

const SERVICES: { key: string; label: string }[] = [
  { key: "residential", label: "住宅" },
  { key: "commercial", label: "商业" },
  { key: "industrial", label: "工业" },
  { key: "office", label: "办公" },
  { key: "utility", label: "公用" },
];

function yuan(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `¥${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `¥${(value / 10_000).toFixed(1)}万`;
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

export function BudgetPanel() {
  const budget = useGame((s) => s.budget);
  const setTaxRate = useGame((s) => s.setTaxRate);
  const takeLoan = useGame((s) => s.takeLoan);
  const [open, setOpen] = useState(false);

  if (!budget) return null;

  const net = budget.day_income - budget.day_expenses;

  return (
    <div className="pointer-events-auto w-72">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-t-lg border border-white/10 bg-slate-900/85 px-3 py-2 text-left text-xs text-slate-200 backdrop-blur"
      >
        <span>
          财政 <span className="font-mono text-emerald-300">{yuan(budget.funds)}</span>
        </span>
        <span className="text-slate-400">{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <div className="space-y-3 rounded-b-lg border border-t-0 border-white/10 bg-slate-900/90 p-3 text-xs text-slate-300 backdrop-blur">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-slate-500">日收入</div>
              <div className="font-mono text-emerald-300">+{yuan(budget.day_income)}</div>
            </div>
            <div>
              <div className="text-slate-500">日支出</div>
              <div className="font-mono text-rose-300">-{yuan(budget.day_expenses)}</div>
            </div>
            <div>
              <div className="text-slate-500">日结余</div>
              <div className={`font-mono ${net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {net >= 0 ? "+" : ""}
                {yuan(net)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">负债</div>
              <div className="font-mono text-amber-300">{yuan(budget.debt)}</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-slate-500">税率（%）</div>
            {SERVICES.map((svc) => {
              const rate = budget.tax_rates[svc.key] ?? 9;
              return (
                <label key={svc.key} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-slate-400">{svc.label}</span>
                  <input
                    type="range"
                    min={1}
                    max={29}
                    step={1}
                    value={rate}
                    onChange={(e) => void setTaxRate(svc.key, Number(e.target.value))}
                    className="h-1 flex-1 accent-emerald-400"
                  />
                  <span className="w-8 shrink-0 text-right font-mono text-slate-200">
                    {rate}
                  </span>
                </label>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void takeLoan(100_000, 60)}
            className="w-full rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-amber-200 transition hover:bg-amber-400/20"
          >
            贷款 ¥10万 · 60 期
          </button>
        </div>
      ) : null}
    </div>
  );
}
