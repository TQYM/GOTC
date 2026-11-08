"use client";

/**
 * 右上时间控制区（WorldBox 重构，PR-15）：
 * - 阶段徽章 + 城市年份（年份在 TopBar）+ 投影进度；
 * - 圆形能力按钮：快进一年 / 推演 10 年 / 生成报告 / 请教导师 / 历史报告 / 返回建设；
 * - 只展示后端给的 phase 与 city_year，不推算、无任何倒计时；
 * - 「推演」= finalize（会锁定本局），点击前二次确认（当前 v1 后端）。
 */
import { useEffect, useState } from "react";
import type { GamePhase } from "@/lib/api";
import { useGame } from "@/store/game";
import ReportHistory from "./ReportHistory";

const PHASE_LABEL: Record<GamePhase, string> = {
  briefing: "规划简报",
  building: "自由建设",
  projecting: "未来推演",
  report: "城市诊断",
};

const PHASE_TONE: Record<GamePhase, string> = {
  briefing: "text-slate-200",
  building: "text-emerald-200",
  projecting: "text-sky-200",
  report: "text-violet-200",
};

const NOT_YET = "当前后端未启用此能力；请使用 saves v2 完整后端";

function RoundAction({
  testId,
  icon,
  label,
  disabled,
  why,
  onClick,
}: {
  testId: string;
  icon: string;
  label: string;
  disabled: boolean;
  why?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={disabled && why ? why : label}
      disabled={disabled}
      onClick={onClick}
      className="wb-round"
    >
      <span className="text-xl leading-none" aria-hidden>
        {icon}
      </span>
    </button>
  );
}

export default function PhaseBanner() {
  const api = useGame((s) => s.api);
  const phase = useGame((s) => s.phase);
  const busy = useGame((s) => s.busy);
  const projection = useGame((s) => s.projection);
  const projectionYear = useGame((s) => s.projectionYear);
  const projectionId = useGame((s) => s.projectionId);
  const projectionBaseYear = useGame((s) => s.projectionBaseYear);
  const projectionBaseSeq = useGame((s) => s.projectionBaseSeq);
  const cityReport = useGame((s) => s.cityReport);
  const advanceYear = useGame((s) => s.advanceYear);
  const project = useGame((s) => s.project);
  const makeReport = useGame((s) => s.makeReport);
  const backToBuilding = useGame((s) => s.backToBuilding);
  const askMentor = useGame((s) => s.askMentor);
  const loadReports = useGame((s) => s.loadReports);
  const [confirmLock, setConfirmLock] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const caps = api?.capabilities;
  const building = phase === "building";
  const firstYear = projection[0]?.year ?? 0;
  const lastYear = projection[projection.length - 1]?.year ?? 0;
  const played =
    projectionYear > 0 && lastYear > 0
      ? Math.min(1, (projectionYear - firstYear + 1) / projection.length)
      : 0;

  useEffect(() => {
    if (api?.kind !== "v2" || phase !== "projecting" || projection.length === 0) return;
    const currentIndex = projection.findIndex((item) => item.year === projectionYear);
    const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
    if (nextIndex >= projection.length) return;
    const timer = window.setTimeout(() => {
      useGame.getState().applyEvent({
        id: null,
        event: "projection_step",
        data: projection[nextIndex],
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [api?.kind, phase, projection, projectionYear]);

  return (
    <>
      <div
        className="pointer-events-none absolute right-3 top-3 z-20 flex max-w-[min(20rem,46vw)] flex-col items-end gap-2"
        data-testid="phase-banner"
      >
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          <span
            data-testid="phase-label"
            className={`wb-pill py-1 text-xs font-bold ${PHASE_TONE[phase]}`}
          >
            {PHASE_LABEL[phase]}
          </span>
          {phase === "projecting" && projection.length > 0 && (
            <span
              data-testid="projection-progress"
              className="wb-pill py-1 text-[11px]"
              title={`推演至第 ${Math.max(projectionYear, firstYear - 1)} / ${lastYear} 年`}
            >
              <span className="tabular-nums">
                {Math.max(projectionYear, firstYear - 1)}/{lastYear} 年
              </span>
              <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-black/40">
                <span
                  className="block h-full rounded-full bg-sky-400 transition-[width]"
                  style={{ width: `${played * 100}%` }}
                />
              </span>
            </span>
          )}
          {phase === "projecting" && projectionId && (
            <span className="wb-pill py-1 text-[10px]" data-testid="projection-identity">
              base 第 {projectionBaseYear} 年 · seq {projectionBaseSeq}
            </span>
          )}
          {phase === "report" && cityReport?.baseYear !== undefined && (
            <span className="wb-pill py-1 text-[10px]" data-testid="report-identity">
              base 第 {cityReport.baseYear} 年 · seq {cityReport.baseSeq}
            </span>
          )}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          {building && (
            <>
              <RoundAction
                testId="advance-year"
                icon="⏭️"
                label="快进一年：收税、人口迁移、年度事件"
                disabled={busy || !caps?.advanceYear}
                why={NOT_YET}
                onClick={() => void advanceYear()}
              />
              <RoundAction
                testId="project"
                icon="🔮"
                label={caps?.projectLocksCity ? "推演 10 年（会锁定本局）" : "只读预览未来 10 年"}
                disabled={busy || !caps?.project}
                why={NOT_YET}
                onClick={() => (caps?.projectLocksCity ? setConfirmLock(true) : void project())}
              />
              <RoundAction
                testId="report"
                icon="📋"
                label="生成报告：五维评分 + 规划导师诊断"
                disabled={busy || !caps?.report}
                why={caps?.projectLocksCity ? "当前后端版本的报告随「推演 10 年」一起生成" : NOT_YET}
                onClick={() => void makeReport()}
              />
              <RoundAction
                testId="mentor"
                icon="🎓"
                label="请教导师（异步，不阻塞经营）"
                disabled={busy || !caps?.mentor}
                why={NOT_YET}
                onClick={() => void askMentor()}
              />
            </>
          )}
          {phase !== "briefing" && (
            <RoundAction
              testId="report-history-toggle"
              icon="🗂️"
              label="历史城市报告（最近 20 份）"
              disabled={!caps?.reportHistory}
              why={NOT_YET}
              onClick={() => {
                setHistoryOpen((value) => !value);
                if (!historyOpen) void loadReports();
              }}
            />
          )}
          {(phase === "projecting" || phase === "report") && caps && !caps.projectLocksCity && (
            <RoundAction
              testId="back-to-building"
              icon="↩️"
              label="回到自由建设"
              disabled={busy}
              onClick={() => void backToBuilding()}
            />
          )}
        </div>
      </div>

      {historyOpen && <ReportHistory onClose={() => setHistoryOpen(false)} />}

      {confirmLock && (
        <div
          className="pointer-events-auto fixed inset-0 z-40 grid place-items-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          data-testid="confirm-lock"
        >
          <div className="wb-panel w-full max-w-sm rounded-2xl p-4">
            <p className="text-sm font-bold">推演后本局将锁定</p>
            <p className="mt-1 text-xs text-[var(--wb-ink-muted)]">
              当前后端版本还没有「只读推演」，推演 10 年会直接出报告并结束建设。确定现在推演吗？
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="min-h-10 rounded-full border border-[var(--wb-gold-line)] px-4 text-sm"
                onClick={() => setConfirmLock(false)}
              >
                再建一会
              </button>
              <button
                type="button"
                data-testid="confirm-lock-ok"
                className="min-h-10 rounded-full bg-[var(--wb-gold)] px-4 text-sm font-bold text-[#1c1610] active:scale-95"
                onClick={() => {
                  setConfirmLock(false);
                  void project();
                }}
              >
                推演并出报告
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
