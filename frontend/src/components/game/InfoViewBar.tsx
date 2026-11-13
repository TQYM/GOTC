"use client";

/**
 * 信息视图切换，对标 C:S 的 InfoManager（左侧竖排图标）。
 *
 * C:S 里切到「地价 / 污染 / 交通」时整片楼会按数值改色；这里用全城指标
 * 做同一件事——颜色不精确到单栋，但「哪一项在恶化」一眼可见。
 */

import { useGame } from "@/store/game";
import type { InfoViewType } from "@/store/game";

const VIEWS: { key: InfoViewType; label: string; icon: string }[] = [
  { key: "default", label: "默认", icon: "◻" },
  { key: "landprice", label: "地价", icon: "¥" },
  { key: "pollution", label: "污染", icon: "☁" },
  { key: "traffic", label: "交通", icon: "⇄" },
  { key: "happiness", label: "幸福", icon: "☺" },
  { key: "jobs", label: "就业", icon: "⚒" },
];

export function InfoViewBar({ vertical = true }: { vertical?: boolean } = {}) {
  const infoView = useGame((s) => s.infoView);
  const setInfoView = useGame((s) => s.setInfoView);

  return (
    <div className={vertical ? "pointer-events-auto grid grid-cols-3 gap-1" : "pointer-events-auto flex flex-col gap-1"} role="group" aria-label="信息视图">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          aria-pressed={infoView === v.key}
          data-testid={`info-view-${v.key}`}
          onClick={() => setInfoView(v.key)}
          title={v.label}
          className="px-tab flex h-9 w-9 items-center justify-center text-base font-bold"
          style={{ opacity: infoView === v.key ? 1 : 0.55, color: "#2A2340" }}
        >
          {v.icon}
        </button>
      ))}
    </div>
  );
}
