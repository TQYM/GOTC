"use client";

/**
 * 左上世界徽章（WorldBox 重构）：城市名 + 第 N 年 + 8 位城市码。
 * 阶段徽章与时间控制在 PhaseBanner（右上），资源胶囊在顶部中央。
 */
import { useGame } from "@/store/game";

export default function TopBar() {
  const cityName = useGame((s) => s.cityName);
  const cityYear = useGame((s) => s.cityYear);
  const id = useGame((s) => s.id);
  const initial = (cityName ?? "城").trim().slice(0, 1);

  return (
    <div className="pointer-events-auto wb-anim-rise">
      <div className="wb-panel flex items-center gap-2.5 rounded-2xl py-1.5 pl-1.5 pr-3">
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--wb-gold)] text-lg font-black text-[#1c1610] shadow-[inset_0_-2px_0_rgba(0,0,0,.18)]"
          aria-hidden
        >
          {initial}
        </div>
        <div className="min-w-0">
          <div className="max-w-[11rem] truncate text-sm font-bold leading-tight">
            {cityName ?? "CITY20 城市"}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--wb-ink-muted)]">
            <span data-testid="city-year" data-year={cityYear} className="tabular-nums">
              第 {cityYear} 年
            </span>
            {id && (
              <>
                <span aria-hidden>·</span>
                <code
                  data-testid="city-code"
                  title="8 位城市码，分享给队友可协作"
                  className="truncate text-[10px] tracking-wider"
                >
                  {id}
                </code>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
