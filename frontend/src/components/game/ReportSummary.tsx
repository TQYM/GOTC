"use client";

/**
 * report 态的诊断摘要（PR-15 占位展示：五维分数 + 体检标签 + 总评）。
 * 完整报告页（自绘 SVG 雷达、结局徽章插画、分享）在 PR-16。
 */
import type { Ending, Scores } from "@/lib/contract";
import { useGame } from "@/store/game";

/** 结局 → 城市体检标签（10 §1：结局语义改为报告时点的体检标签） */
export const ENDING_LABEL: Record<Ending, string> = {
  bankrupt: "财政告急",
  eco_paradise: "生态乌托邦",
  gridlock: "拥堵之城",
  ghost_town: "空心之城",
  thriving: "明日之城",
  ordinary: "平凡之城",
};

export const SCORE_LABEL: Record<keyof Scores, string> = {
  population: "人口活力",
  balance: "职住平衡",
  green: "绿色生态",
  traffic: "交通效率",
  happiness: "市民幸福",
};

export default function ReportSummary() {
  const phase = useGame((s) => s.phase);
  const rep = useGame((s) => s.cityReport);
  if (phase !== "report" || !rep) return null;
  return (
    <div
      className="px-panel px-anim-rise absolute inset-x-0 top-[8.5rem] z-10 mx-auto w-[min(28rem,calc(100%-1.5rem))] p-4"
      data-testid="report-summary"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-normal">
          {rep.cityName ?? "城市诊断"}
        </h2>
        <span
          className="px-chip bg-[var(--px-grape)] text-white"
          data-testid="ending-label"
        >
          {ENDING_LABEL[rep.ending]}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {(Object.keys(SCORE_LABEL) as (keyof Scores)[]).map((k) => (
          <li key={k} className="flex items-center gap-2 text-xs">
            <span className="w-16 text-fg-muted">{SCORE_LABEL[k]}</span>
            <span className="h-3 flex-1 overflow-hidden bg-[var(--px-paper-2)] shadow-[0_0_0_2px_var(--px-ink)]">
              <span
                className="block h-full bg-[var(--px-grape)]"
                style={{ width: `${rep.scores[k]}%` }}
              />
            </span>
            <span
              className="w-7 text-right tabular-nums"
              data-testid={`score-${k}`}
            >
              {rep.scores[k]}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">{rep.report.overview}</p>
    </div>
  );
}
