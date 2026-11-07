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
      className="absolute inset-x-0 top-16 z-10 mx-auto w-[min(28rem,calc(100%-1.5rem))] rounded-xl border border-violet-400/50 bg-bg-elev/95 p-4 shadow-2xl"
      data-testid="report-summary"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          {rep.cityName ?? "城市诊断"}
        </h2>
        <span
          className="rounded-full bg-violet-500/30 px-2 py-0.5 text-xs"
          data-testid="ending-label"
        >
          {ENDING_LABEL[rep.ending]}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {(Object.keys(SCORE_LABEL) as (keyof Scores)[]).map((k) => (
          <li key={k} className="flex items-center gap-2 text-xs">
            <span className="w-16 text-fg-muted">{SCORE_LABEL[k]}</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-line">
              <span
                className="block h-full bg-violet-400"
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
