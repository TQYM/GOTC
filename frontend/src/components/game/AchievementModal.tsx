"use client";

/**
 * 成就弹窗。
 *
 * 与 `Toasts` 的区别：toast 是「刚发生了什么」的流水，几秒就没了；
 * 成就是一次性的里程碑，需要玩家确认。所以用居中模态，不做自动淡出——
 * 但加一个 8 秒后自动收起，避免玩家离开时留一个永远不关的窗口。
 *
 * 队列：一次只显示一个。同时达成多个时（比如放第一栋楼同时跨过 1,000 人也
 * 有可能），后面的排队，点「收下」推下一个。
 */

import { useEffect, useState } from "react";
import { useGame } from "@/store/game";
import type { Achievement, AchievementTone } from "@/lib/achievements";

const TONE_STYLES: Record<AchievementTone, { bg: string; border: string; ink: string }> = {
  ok: { bg: "#3DD68C", border: "#2A2340", ink: "#123B24" },
  sun: { bg: "#FFC93C", border: "#2A2340", ink: "#4A3608" },
  blue: { bg: "#3D8BFF", border: "#2A2340", ink: "#0D2A57" },
  grape: { bg: "#9D7BFF", border: "#2A2340", ink: "#2A1A55" },
  berry: { bg: "#FF5C7A", border: "#2A2340", ink: "#4A1220" },
};

export function AchievementModal() {
  const queue = useGame((s) => s.achievementQueue);
  const shown = queue;
  const dismiss = useGame((s) => s.dismissAchievement);
  const [leaving, setLeaving] = useState(false);
  const current: Achievement | undefined = shown[0];

  // 切换成就时重置离场状态
  useEffect(() => {
    setLeaving(false);
  }, [current?.id]);

  // 8 秒自动收起：玩家可能已经切走了，留一个不关的窗口很难受
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setLeaving(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [current?.id]);

  // 离场动画结束后再真正出队
  useEffect(() => {
    if (!leaving || !current) return;
    const timer = window.setTimeout(() => {
      dismiss();
      setLeaving(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [leaving, current, dismiss]);

  if (!current) return null;
  const tone = TONE_STYLES[current.tone];

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center"
      aria-live="polite"
    >
      {/* 遮罩很淡：这是成就，不是错误，不该把整张地图压黑 */}
      <div
        className="absolute inset-0 bg-[#2A2340] transition-opacity duration-200"
        style={{ opacity: leaving ? 0 : 0.18 }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievement-title"
        data-testid="achievement-modal"
        className="pointer-events-auto relative w-[22rem] max-w-[calc(100%-2rem)] px-panel p-4"
        style={{
          transform: leaving ? "translateY(6px) scale(0.98)" : "translateY(0) scale(1)",
          opacity: leaving ? 0 : 1,
          transition: "transform 180ms cubic-bezier(0.23,1,0.32,1), opacity 180ms",
        }}
      >
        {/* 顶部：图标 + 「成就达成」 */}
        <div className="flex items-center gap-3">
          <div
            className="grid h-12 w-12 place-items-center border-[2px] text-[22px] leading-none"
            style={{
              background: tone.bg,
              borderColor: tone.border,
              color: tone.ink,
              boxShadow: "inset -3px -3px 0 rgba(42,35,64,0.18)",
            }}
            aria-hidden
          >
            {current.icon}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-[0.18em] text-px-ink-soft">
              成就达成
            </div>
            <div
              id="achievement-title"
              className="truncate text-[17px] font-bold leading-tight text-px-ink"
            >
              {current.title}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-px-ink-soft">
          {current.desc}
        </p>

        <div className="mt-4 flex items-center justify-between">
          <span className="font-mono text-[10px] text-px-ink-soft">
            {shown.length > 1 ? `还有 ${shown.length - 1} 个` : "已记入档案"}
          </span>
          <button
            type="button"
            onClick={() => setLeaving(true)}
            data-testid="achievement-dismiss"
            className="px-btn px-btn-primary-tone h-8 w-auto px-3 text-[12px]"
            style={{ width: "auto", height: "2rem", fontSize: 12 }}
          >
            收下
          </button>
        </div>
      </div>
    </div>
  );
}
