"use client";

/**
 * 右侧 AI 信息流（05 §2.3 / §3.3，PR-14）：
 * - 三角色分组样式：数据大脑 = 新闻卡；市民之声 = 微博气泡；规划导师 = 点评面板（理论引用 + Top 问题）；
 * - 自动滚到底；玩家上翻阅读时暂停，并提示「有新消息」；
 * - 连接状态点 + 断线红条「连接中断，重连中…」，超过 30s 提示刷新；恢复后自动隐藏；
 * - AI 消息延迟到达不阻塞任何交互（无加载态）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedItem } from "@/store/game";
import { useGame } from "@/store/game";
import { PixelIcon } from "@/components/ui/PixelSprite";

type Filter = "all" | "news" | "citizen" | "mentor";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "news", label: "数据大脑" },
  { key: "citizen", label: "市民之声" },
  { key: "mentor", label: "规划导师" },
];

const THEORY: Record<string, string> = {
  tod: "TOD 公交导向",
  life_circle_15: "15 分钟生活圈",
  jobs_housing_balance: "职住平衡",
  green_network: "绿地网络",
  road_hierarchy: "路网分级",
};

const SENTIMENT: Record<string, { tint: string; chip: string; label: string }> = {
  angry: { tint: "var(--px-tint-berry)", chip: "var(--px-bad)", label: "不满" },
  happy: { tint: "var(--px-tint-mint)", chip: "var(--px-ok)", label: "满意" },
  neutral: { tint: "var(--px-paper-2)", chip: "var(--px-slate)", label: "中立" },
};

const SEVERITY: Record<string, string> = {
  info: "var(--px-blue)",
  warning: "var(--px-warn)",
  alert: "var(--px-bad)",
};

function AiBadge({ source }: { source: "ai" | "template" }) {
  return source === "ai" ? (
    <span className="px-chip bg-[var(--px-tint-grape)] px-1 text-[10px]">AI</span>
  ) : null;
}

function Item({ item }: { item: FeedItem }) {
  switch (item.kind) {
    case "news":
      return (
        <article
          data-testid="feed-news"
          className="px-bubble flex gap-2.5 px-3 py-2"
        >
          <span
            className="w-1.5 shrink-0 self-stretch"
            style={{ background: SEVERITY[item.data.severity] ?? SEVERITY.info }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
          <header className="flex items-center gap-1.5 text-[11px] text-fg-muted">
            <PixelIcon name="brain" scale={1} />
            数据大脑 · 第 {item.data.at_year} 年{" "}
            <AiBadge source={item.data.source} />
          </header>
          <h3 className="mt-1 text-[15px] leading-snug">{item.data.headline}</h3>
          <p className="text-xs text-fg-muted">{item.data.body}</p>
          </div>
        </article>
      );
    case "citizen": {
      const s = SENTIMENT[item.data.sentiment] ?? SENTIMENT.neutral;
      return (
        <article data-testid="feed-citizen" className="flex gap-2">
          <div
            className="grid h-9 w-9 shrink-0 place-items-center"
            style={{ background: s.tint, boxShadow: "0 0 0 3px var(--px-ink)" }}
            aria-hidden
          >
            <PixelIcon name="citizen" scale={2} />
          </div>
          <div className="px-bubble min-w-0 flex-1 px-3 py-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
              {item.data.persona}
              <span className="px-chip px-1 text-[10px] text-px-ink" style={{ background: s.chip }}>
                {s.label}
              </span>
              <AiBadge source={item.data.source} />
            </div>
            <p className="text-sm">{item.data.text}</p>
          </div>
        </article>
      );
    }
    case "mentor":
      return (
        <article
          data-testid="feed-mentor"
          className="px-bubble px-3 py-2"
          style={{
            background: item.data.severity === "warning" ? "var(--px-tint-sun)" : "var(--px-tint-grape)",
          }}
        >
          <header className="flex items-center gap-1.5 text-[12px]">
            <PixelIcon name="mentor" scale={1} />
            规划导师 <AiBadge source={item.data.source} />
          </header>
          <p className="mt-0.5 text-sm">{item.data.comment}</p>
          {item.data.top_issues.length > 0 && (
            <ol className="mt-1 list-decimal pl-4 text-xs text-fg-muted">
              {item.data.top_issues.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          )}
          {item.data.theory_refs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {item.data.theory_refs.map((r) => (
                <span
                  key={r}
                  className="px-chip bg-[var(--px-paper)] px-1.5 text-[10px]"
                >
                  {THEORY[r] ?? r}
                </span>
              ))}
            </div>
          )}
        </article>
      );
    case "system":
      return (
        <p
          data-testid="feed-system"
          className="text-center text-xs text-fg-muted"
        >
          {item.text}
        </p>
      );
  }
}

/** 断线超过 30s 提示刷新（05 §3.3） */
function useDownTooLong(downSince: number | null) {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (downSince === null) {
      const t = setTimeout(() => setLong(false), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => setLong(true),
      Math.max(0, 30_000 - (Date.now() - downSince)),
    );
    return () => clearTimeout(t);
  }, [downSince]);
  return long;
}

export default function InfoFeed() {
  const feed = useGame((s) => s.feed);
  const conn = useGame((s) => s.conn);
  const downSince = useGame((s) => s.downSince);
  const [filter, setFilter] = useState<Filter>("all");
  const [stick, setStick] = useState(true);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const seen = useRef(feed.length);
  const tooLong = useDownTooLong(conn === "down" ? downSince : null);

  const shown =
    filter === "all"
      ? feed
      : feed.filter((f) => f.kind === filter || f.kind === "system");

  // 新消息：贴底时自动滚到底，否则累计未读
  useLayoutEffect(() => {
    const el = listRef.current;
    const added = feed.length - seen.current;
    seen.current = feed.length;
    if (!el) return;
    if (stick) el.scrollTop = el.scrollHeight;
    else if (added > 0) setUnread((n) => n + added);
  }, [feed.length, stick, filter]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStick(atBottom);
    if (atBottom) setUnread(0);
  };

  const dot =
    conn === "open"
      ? "bg-[var(--px-ok)]"
      : conn === "connecting"
        ? "bg-[var(--px-warn)] px-anim-bob"
        : "bg-[var(--px-bad)] px-anim-bob";
  const connLabel =
    conn === "open" ? "已连接" : conn === "connecting" ? "连接中" : "已断开";

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      data-testid="info-feed"
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-[17px] font-normal">城市动态</h2>
        <span
          className="flex items-center gap-1.5 text-[11px] text-fg-muted"
          data-testid="conn-state"
          data-conn={conn}
        >
          <span className={`px-dot ${dot}`} />
          {connLabel}
        </span>
      </header>

      {conn === "down" && (
        <div
          className="bg-[var(--px-bad)] px-3 py-1.5 text-xs text-px-ink"
          role="status"
          data-testid="conn-banner"
        >
          连接中断，重连中…
          {tooLong && (
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => window.location.reload()}
            >
              已超过 30 秒，点此刷新
            </button>
          )}
        </div>
      )}

      <nav
        className="flex flex-wrap gap-2.5 border-b-[3px] border-[var(--px-ink)] px-3 pb-3 pt-1"
        aria-label="信息流筛选"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className="px-tab"
          >
            {f.label}
          </button>
        ))}
      </nav>

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          className="h-full space-y-3 overflow-y-auto px-3 py-3"
          data-testid="feed-list"
        >
          {shown.length === 0 ? (
            <p className="pt-6 text-center text-xs text-fg-muted">
              建点什么，市民和导师就会开口说话。
            </p>
          ) : (
            shown.map((item) => <Item key={item.key} item={item} />)
          )}
        </div>
        {!stick && unread > 0 && (
          <button
            type="button"
            data-testid="feed-unread"
            onClick={() => {
              setStick(true);
              setUnread(0);
            }}
            className="px-action px-action-primary absolute bottom-3 left-1/2 min-h-9 -translate-x-1/2 text-xs"
          >
            有 {unread} 条新消息 ↓
          </button>
        )}
      </div>
    </section>
  );
}
