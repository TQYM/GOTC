"use client";

/**
 * 左下事件条（WorldBox 重构）：能力坞上方显示最新 2 条市民/导师/新闻动态，
 * 点击打开右侧「动态」面板。无消息时不占位。
 */
import { useGame } from "@/store/game";

const ICON: Record<string, string> = {
  news: "📰",
  citizen: "🗣️",
  mentor: "🎓",
  system: "⚙️",
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
    <div className="pointer-events-auto flex w-[min(20rem,72vw)] flex-col gap-1">
      {latest.map((item, index) => (
        <button
          key={item.key}
          type="button"
          onClick={onOpenFeed}
          className={`wb-panel wb-anim-rise flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left ${
            index === 0 ? "" : "opacity-80"
          }`}
        >
          <span aria-hidden className="text-sm leading-none">
            {ICON[item.kind] ?? "💬"}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--wb-ink)]">
            {excerpt(item)}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--wb-gold)]" aria-hidden>
            ›
          </span>
        </button>
      ))}
    </div>
  );
}
