"use client";

/**
 * 阶段横幅（05 §2.3 PhaseBanner / §3.4，PR-15）：不限时 4 态 + 城市年份徽章 + 三个主动入口。
 * - 只展示后端给的 phase 与 city_year，不推算、无任何倒计时；
 * - 「快进一年」「推演 10 年」「生成报告」只在 building 可用；后端暂不支持的能力置灰并说明原因；
 * - 当前 v1 后端的「推演」= finalize（会锁定本局），点击前二次确认。
 */
import { useState } from "react";
import type { GamePhase } from "@/lib/api";
import { useGame } from "@/store/game";

const PHASE_LABEL: Record<GamePhase, string> = {
  briefing: "规划简报",
  building: "自由建设",
  projecting: "未来推演",
  report: "城市诊断",
};

const PHASE_TONE: Record<GamePhase, string> = {
  briefing: "bg-slate-500/30 text-slate-100",
  building: "bg-emerald-500/25 text-emerald-100",
  projecting: "bg-sky-500/25 text-sky-100",
  report: "bg-violet-500/25 text-violet-100",
};

const NOT_YET = "当前后端版本暂不支持，存档接口（10 号文档 §5）上线后可用";

function ActionButton({
  testId,
  label,
  hint,
  disabled,
  why,
  onClick,
}: {
  testId: string;
  label: string;
  hint: string;
  disabled: boolean;
  why?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      title={disabled && why ? why : hint}
      onClick={onClick}
      className="min-h-11 rounded-md border border-line bg-bg-elev/90 px-3 text-sm font-semibold hover:border-accent disabled:cursor-not-allowed disabled:opacity-45"
    >
      {label}
    </button>
  );
}

export default function PhaseBanner() {
  const api = useGame((s) => s.api);
  const phase = useGame((s) => s.phase);
  const cityYear = useGame((s) => s.cityYear);
  const busy = useGame((s) => s.busy);
  const projection = useGame((s) => s.projection);
  const projectionYear = useGame((s) => s.projectionYear);
  const advanceYear = useGame((s) => s.advanceYear);
  const project = useGame((s) => s.project);
  const makeReport = useGame((s) => s.makeReport);
  const backToBuilding = useGame((s) => s.backToBuilding);
  const [confirmLock, setConfirmLock] = useState(false);

  const caps = api?.capabilities;
  const building = phase === "building";
  const firstYear = projection[0]?.year ?? 0;
  const lastYear = projection[projection.length - 1]?.year ?? 0;
  const played =
    projectionYear > 0 && lastYear > 0
      ? Math.min(1, (projectionYear - firstYear + 1) / projection.length)
      : 0;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 p-3"
      data-testid="phase-banner"
    >
      <div className="pointer-events-auto flex items-center gap-2">
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${PHASE_TONE[phase]}`}
          data-testid="phase-label"
        >
          {PHASE_LABEL[phase]}
        </span>
        <span
          className="rounded-full bg-bg-elev/90 px-3 py-1 text-sm font-semibold tabular-nums"
          data-testid="city-year"
          data-year={cityYear}
        >
          第 {cityYear} 年
        </span>
        {phase === "projecting" && projection.length > 0 && (
          <span
            className="flex items-center gap-2 rounded-full bg-bg-elev/90 px-3 py-1 text-xs"
            data-testid="projection-progress"
          >
            推演至第 {Math.max(projectionYear, firstYear - 1)} / {lastYear} 年
            <span className="inline-block h-1.5 w-20 overflow-hidden rounded bg-line">
              <span
                className="block h-full bg-sky-400 transition-all"
                style={{ width: `${played * 100}%` }}
              />
            </span>
          </span>
        )}
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        {building && (
          <>
            <ActionButton
              testId="advance-year"
              label="快进一年"
              hint="城市过一年：收税、人口迁移、年度事件"
              disabled={busy || !caps?.advanceYear}
              why={NOT_YET}
              onClick={() => void advanceYear()}
            />
            <ActionButton
              testId="project"
              label="推演 10 年"
              hint={
                caps?.projectLocksCity
                  ? "预览未来 10 年（当前后端：推演后本局锁定）"
                  : "只读预览未来 10 年，不影响当前城市"
              }
              disabled={busy || !caps?.project}
              why={NOT_YET}
              onClick={() =>
                caps?.projectLocksCity ? setConfirmLock(true) : void project()
              }
            />
            <ActionButton
              testId="report"
              label="生成报告"
              hint="城市体检：五维评分 + 规划导师诊断"
              disabled={busy || !caps?.report}
              why={
                caps?.projectLocksCity
                  ? "当前后端版本的报告随「推演 10 年」一起生成"
                  : NOT_YET
              }
              onClick={() => void makeReport()}
            />
          </>
        )}
        {(phase === "projecting" || phase === "report") &&
          caps &&
          !caps.projectLocksCity && (
            <ActionButton
              testId="back-to-building"
              label="返回建设"
              hint="回到自由建设，继续经营"
              disabled={busy}
              onClick={() => void backToBuilding()}
            />
          )}
      </div>

      {confirmLock && (
        <div
          className="pointer-events-auto absolute inset-x-0 top-16 mx-auto w-96 rounded-xl border border-amber-400/60 bg-bg-elev p-4 shadow-2xl"
          role="dialog"
          aria-modal="true"
          data-testid="confirm-lock"
        >
          <p className="text-sm font-semibold">推演后本局将锁定</p>
          <p className="mt-1 text-xs text-fg-muted">
            当前后端版本还没有「只读推演」，推演 10
            年会直接出报告并结束建设。确定现在推演吗？
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="min-h-10 rounded-md border border-line px-3 text-sm"
              onClick={() => setConfirmLock(false)}
            >
              再建一会
            </button>
            <button
              type="button"
              data-testid="confirm-lock-ok"
              className="min-h-10 rounded-md bg-amber-500 px-3 text-sm font-semibold text-black"
              onClick={() => {
                setConfirmLock(false);
                void project();
              }}
            >
              推演并出报告
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
