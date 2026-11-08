"use client";

import { ENDING_LABEL } from "./ReportSummary";
import { useGame } from "@/store/game";
import { PixelIcon } from "@/components/ui/PixelSprite";

export default function ReportHistory({ onClose }: { onClose: () => void }) {
  const reports = useGame((s) => s.reportHistory);
  const openReport = useGame((s) => s.openReport);
  return (
    <section
      className="px-panel px-anim-slide-right pointer-events-auto absolute right-4 top-[8.5rem] z-20 max-h-[70vh] w-[min(25rem,calc(100%-1.5rem))] overflow-y-auto p-4"
      data-testid="report-history"
      aria-label="历史城市报告"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-normal">历史城市报告（最近 20 份）</h2>
        <button type="button" onClick={onClose} className="px-icon-btn" aria-label="关闭历史报告"><PixelIcon name="close" scale={1} /></button>
      </header>
      {reports.length === 0 ? (
        <p className="mt-3 text-xs text-fg-muted">还没有报告，或历史正在加载。关闭后可稍后重试。</p>
      ) : (
        <ul className="mt-3 grid gap-3 p-0.5">
          {reports.map((result) => (
            <li key={result.report_id}>
              <button
                type="button"
                className="px-card w-full px-3 py-2 text-left"
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
