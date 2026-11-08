"use client";

/**
 * 右侧城市面板（16 §4.4）：两个页签——「城市」指标与能力摘要 /「动态」AI 信息流。
 * 收起时不影响任何游戏操作；点能力坞「城市面板 / 城市动态」或面板关闭按钮切换。
 */
import InfoFeed from "@/components/game/InfoFeed";
import { MetricsDetail } from "@/components/game/MetricsPanel";
import { PixelIcon } from "@/components/ui/PixelSprite";
import { useGame } from "@/store/game";
import { usePrefs, type PixelScale } from "@/store/prefs";

const PIXEL_OPTIONS: { value: PixelScale; label: string }[] = [
  { value: 0, label: "关" },
  { value: 2, label: "细 2×" },
  { value: 3, label: "粗 3×" },
];

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
  const pixelScale = usePrefs((s) => s.pixelScale);
  const setPixelScale = usePrefs((s) => s.setPixelScale);

  return (
    <aside
      className="pointer-events-auto px-panel px-anim-slide-right flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="inspector-panel"
      aria-label="城市面板"
    >
      <header className="flex items-center gap-2 border-b-[3px] border-[var(--px-ink)] px-3 py-3">
        <div className="flex flex-1 items-center gap-3" role="group" aria-label="面板切换">
          <button
            type="button"
            aria-pressed={tab === "city"}
            onClick={() => onTab("city")}
            className="px-tab"
          >
            <PixelIcon name="city" scale={1} />
            城市
          </button>
          <button
            type="button"
            aria-pressed={tab === "feed"}
            onClick={() => onTab("feed")}
            className="px-tab"
          >
            <PixelIcon name="feed" scale={1} />
            动态
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起面板"
          className="px-icon-btn h-8 w-8"
        >
          <PixelIcon name="close" scale={1} />
        </button>
      </header>

      {tab === "city" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
          <div className="px-well px-3 py-2.5">
            <div className="text-[11px] text-[var(--px-ink-soft)]">当前阶段</div>
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-[17px]">{PHASE_LABEL[phase] ?? phase}</span>
              <span className="px-chip bg-[var(--px-sun)] tabular-nums">
                第 {cityYear} 年
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] text-[var(--px-ink-soft)]">
              {parcel ? `${parcel.district_name ?? parcel.parcel_id ?? "沙盒"} · ${parcel.size}×${parcel.size} 格` : "—"}
            </div>
          </div>

          <MetricsDetail />

          <div className="px-well grid gap-2 px-3 py-2.5" data-testid="pixel-scale">
            <div className="text-[11px] text-[var(--px-ink-soft)]">画面 · 像素度（只影响本设备）</div>
            <div className="flex gap-2.5" role="group" aria-label="像素度">
              {PIXEL_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={pixelScale === o.value}
                  onClick={() => setPixelScale(o.value)}
                  className="px-tab"
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-bubble px-3 py-2.5 text-[12px] leading-relaxed text-[var(--px-ink-soft)]">
            <p className="text-[14px] text-[var(--px-ink)]">城市经营提示</p>
            <p className="mt-1">点右上「快进一年」收税；拆建筑可收回 30%；既有建筑用能力坞的「更新改造」。</p>
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
