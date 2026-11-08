"use client";

import { ENDING_LABEL } from "./ReportSummary";
import { useGame } from "@/store/game";

export default function ReportHistory({ onClose }: { onClose: () => void }) {
  const reports = useGame((s) => s.reportHistory);
  const openReport = useGame((s) => s.openReport);
  return (
    <section
      className="pointer-events-auto absolute right-3 top-16 z-20 max-h-[70vh] w-[min(25rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-line bg-bg-elev/95 p-4 shadow-2xl"
      data-testid="report-history"
      aria-label="历史城市报告"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">历史城市报告（最近 20 份）</h2>
        <button type="button" onClick={onClose} className="min-h-9 px-2 text-sm" aria-label="关闭历史报告">×</button>
      </header>
      {reports.length === 0 ? (
        <p className="mt-3 text-xs text-fg-muted">还没有报告，或历史正在加载。关闭后可稍后重试。</p>
      ) : (
        <ul className="mt-2 grid gap-1">
          {reports.map((result) => (
            <li key={result.report_id}>
              <button
                type="button"
                className="w-full rounded-md border border-line px-3 py-2 text-left hover:border-accent"
                onClick={() => { openReport(result); onClose(); }}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                  <span>第 {result.base_year} 年 · {ENDING_LABEL[result.ending]}</span>
                  <span>#{result.base_seq}</span>
                </span>
                <span className="mt-1 block text-xs text-fg-muted">
                  {new Date(result.created_at).toLocaleString("zh-CN")} · {result.city_name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
