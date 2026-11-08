"use client";

/**
 * 左上城市徽章（16 §4.4）：方形像素头像框（城市名首字）+ 城市名 + 第 N 年 + 8 位城市码票据。
 * 时间控制在 PhaseBanner（右上），资源槽在顶部中央。
 */
import { useGame } from "@/store/game";

export default function TopBar({ title }: { title?: string | null } = {}) {
  const cityName = useGame((s) => s.cityName);
  const cityYear = useGame((s) => s.cityYear);
  const id = useGame((s) => s.id);
  // 左上角标题是"当前在看什么"：选中的建筑 → 视野所在的区 → 城市名
  const heading = title?.trim() || cityName || "CITY20 城市";
  const initial = (cityName ?? "城").trim().slice(0, 1);

  return (
    <div className="pointer-events-auto px-anim-rise">
      <div className="px-panel flex items-center gap-3 py-2 pl-2 pr-4">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center bg-[var(--px-sun)] text-[28px] leading-none text-[var(--px-ink)]"
          style={{
            boxShadow:
              "0 0 0 3px var(--px-ink), inset 0 -5px 0 var(--px-sun-dark), inset 3px 3px 0 var(--px-sun-light)",
          }}
          aria-hidden
        >
          {initial}
        </div>
        <div className="min-w-0">
          <div className="max-w-[13rem] truncate text-[19px] leading-tight">
            {heading}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] leading-none">
            <span data-testid="city-year" data-year={cityYear} className="tabular-nums">
              第 {cityYear} 年
            </span>
            {id && (
              <code
                data-testid="city-code"
                title="8 位城市码，分享给队友可协作"
                className="px-chip truncate bg-[var(--px-paper-2)] font-sans tracking-wider"
              >
                {id}
              </code>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
