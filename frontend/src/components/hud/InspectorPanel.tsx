"use client";

/**
 * 右侧城市面板（WorldBox 重构）：两个 tab——「城市」指标与能力摘要 /「动态」AI 信息流。
 * 收起时不影响任何游戏操作；点能力坞 📊 / 💬 或面板 ✕ 切换。
 */
import InfoFeed from "@/components/game/InfoFeed";
import { MetricsDetail } from "@/components/game/MetricsPanel";
import { useGame } from "@/store/game";

const PHASE_LABEL: Record<string, string> = {
  briefing: "规划简报",
  building: "自由建设",
  projecting: "未来推演",
  report: "城市诊断",
};

export default function InspectorPanel({
  tab,
  onTab,
  onClose,
}: {
  tab: "city" | "feed";
  onTab: (tab: "city" | "feed") => void;
  onClose: () => void;
}) {
  const phase = useGame((s) => s.phase);
  const cityYear = useGame((s) => s.cityYear);
  const parcel = useGame((s) => s.parcel);

  return (
    <aside
      className="pointer-events-auto wb-panel wb-anim-slide-right flex h-full min-h-0 flex-col overflow-hidden rounded-2xl"
      data-testid="inspector-panel"
      aria-label="城市面板"
    >
      <header className="flex items-center gap-1.5 border-b border-[var(--wb-gold-line)] px-2.5 py-2">
        <div className="flex flex-1 items-center gap-1" role="group" aria-label="面板切换">
          <button
            type="button"
            aria-pressed={tab === "city"}
            onClick={() => onTab("city")}
            className="wb-tab"
          >
            📊 城市
          </button>
          <button
            type="button"
            aria-pressed={tab === "feed"}
            onClick={() => onTab("feed")}
            className="wb-tab"
          >
            💬 动态
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起面板"
          className="grid h-7 w-7 place-items-center rounded-full text-xs text-[var(--wb-ink-muted)] transition hover:bg-white/5 hover:text-[var(--wb-ink)] active:scale-95"
        >
          ✕
        </button>
      </header>

      {tab === "city" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 py-2.5">
          <div className="rounded-xl border border-[var(--wb-gold-line)] bg-black/15 px-2.5 py-2">
            <div className="text-[11px] text-[var(--wb-ink-muted)]">当前阶段</div>
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-sm font-bold">{PHASE_LABEL[phase] ?? phase}</span>
              <span className="text-xs tabular-nums text-[var(--wb-gold-strong)]">
                第 {cityYear} 年
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] text-[var(--wb-ink-muted)]">
              {parcel ? `${parcel.district_name ?? parcel.parcel_id ?? "沙盒"} · ${parcel.size}×${parcel.size} 格` : "—"}
            </div>
          </div>

          <MetricsDetail />

          <div className="rounded-xl border border-[var(--wb-gold-line)] bg-black/10 px-2.5 py-2 text-[11px] leading-relaxed text-[var(--wb-ink-muted)]">
            <p className="font-semibold text-[var(--wb-ink)]">城市经营提示</p>
            <p className="mt-1">点右上 ⏭️ 快进一年收税；拆建筑可收回 30%；既有建筑用 🏚️ 更新改造。</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <InfoFeed />
        </div>
      )}
    </aside>
  );
}
