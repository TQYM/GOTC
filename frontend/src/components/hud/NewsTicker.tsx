"use client";

/**
 * 左下对话气泡（16 §4.4）：能力坞上方显示最新 2 条市民 / 导师 / 数据大脑动态（像素头像 + 名牌），
 * 点击打开右侧「动态」面板。无消息时不占位。
 */
import { PixelIcon } from "@/components/ui/PixelSprite";
import type { IconName } from "@/lib/pixelArt";
import { useGame } from "@/store/game";

/** 三角色头像 + 名牌色（16 §4.4：AI 角色各配像素头像） */
const ROLE: Record<string, { icon: IconName; name: string; bg: string; tint: string }> = {
  news: { icon: "brain", name: "数据大脑", bg: "var(--px-blue)", tint: "var(--px-tint-blue)" },
  citizen: { icon: "citizen", name: "市民之声", bg: "var(--px-mint)", tint: "var(--px-tint-mint)" },
  mentor: { icon: "mentor", name: "规划导师", bg: "var(--px-grape)", tint: "var(--px-tint-grape)" },
};

function excerpt(item: ReturnType<typeof useGame.getState>["feed"][number]): string {
  if (item.kind === "news") return item.data.headline;
  if (item.kind === "citizen") return item.data.text;
  if (item.kind === "mentor") return item.data.comment;
  return item.text;
}

export default function NewsTicker({ onOpenFeed }: { onOpenFeed: () => void }) {
  const feed = useGame((s) => s.feed);
  const latest = feed.filter((f) => f.kind !== "system").slice(-2).reverse();
  if (latest.length === 0) return null;

  return (
    <div className="pointer-events-auto flex w-[min(26rem,80vw)] flex-col gap-3">
      {latest.map((item, index) => {
        const role = ROLE[item.kind] ?? ROLE.news;
        return (
          <button
            key={item.key}
            type="button"
            onClick={onOpenFeed}
            className={`px-anim-rise flex items-end gap-3 text-left ${index === 0 ? "" : "opacity-75"}`}
          >
            <span
              className="grid h-11 w-11 shrink-0 place-items-center"
              style={{ background: role.tint, boxShadow: "0 0 0 3px var(--px-ink)" }}
              aria-hidden
            >
              <PixelIcon name={role.icon} scale={2} />
            </span>
            <span className="px-panel flex min-w-0 flex-1 flex-col gap-1 px-3 py-2">
              <span className="px-chip self-start text-[11px] text-white" style={{ background: role.bg }}>
                {role.name}
              </span>
              <span className="line-clamp-2 text-[14px] leading-snug">{excerpt(item)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
