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

const SENTIMENT: Record<string, { ring: string; label: string }> = {
  angry: { ring: "border-red-400/60", label: "不满" },
  happy: { ring: "border-emerald-400/60", label: "满意" },
  neutral: { ring: "border-slate-400/50", label: "中立" },
};

const SEVERITY: Record<string, string> = {
  info: "border-l-sky-400",
  warning: "border-l-amber-400",
  alert: "border-l-red-500",
};

function AiBadge({ source }: { source: "ai" | "template" }) {
  return source === "ai" ? (
    <span className="rounded bg-violet-500/30 px-1 text-[10px] text-violet-200">
      AI
    </span>
  ) : null;
}

function Item({ item }: { item: FeedItem }) {
  switch (item.kind) {
    case "news":
      return (
        <article
          data-testid="feed-news"
          className={`rounded-md border border-line border-l-4 ${SEVERITY[item.data.severity] ?? ""} bg-bg px-3 py-2`}
        >
          <header className="flex items-center gap-1.5 text-[11px] text-fg-muted">
            📰 数据大脑 · 第 {item.data.at_year} 年{" "}
            <AiBadge source={item.data.source} />
          </header>
          <h3 className="mt-0.5 text-sm font-semibold">{item.data.headline}</h3>
          <p className="text-xs text-fg-muted">{item.data.body}</p>
        </article>
      );
    case "citizen": {
      const s = SENTIMENT[item.data.sentiment] ?? SENTIMENT.neutral;
      return (
        <article data-testid="feed-citizen" className="flex gap-2">
          <div
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 ${s.ring} bg-bg-elev text-xs`}
            aria-hidden
          >
            {item.data.persona.slice(-2, -1) || "市"}
          </div>
          <div className="min-w-0 rounded-2xl rounded-tl-sm bg-bg-elev px-3 py-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
              {item.data.persona} · {s.label}{" "}
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
          className={`rounded-lg border px-3 py-2 ${
            item.data.severity === "warning"
              ? "border-amber-400/60 bg-amber-500/10"
              : "border-violet-400/50 bg-violet-500/10"
          }`}
        >
          <header className="flex items-center gap-1.5 text-[11px] text-violet-200">
            🎓 规划导师 <AiBadge source={item.data.source} />
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
                  className="rounded-full bg-violet-500/20 px-2 text-[10px] text-violet-100"
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
      ? "bg-emerald-400"
      : conn === "connecting"
        ? "bg-amber-400 animate-pulse"
        : "bg-red-500 animate-pulse";
  const connLabel =
    conn === "open" ? "已连接" : conn === "connecting" ? "连接中" : "已断开";

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      data-testid="info-feed"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--wb-gold-line)] px-3 py-2">
        <h2 className="text-sm font-bold">城市动态</h2>
        <span
          className="flex items-center gap-1.5 text-[11px] text-fg-muted"
          data-testid="conn-state"
          data-conn={conn}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
          {connLabel}
        </span>
      </header>

      {conn === "down" && (
        <div
          className="bg-red-600/90 px-3 py-1.5 text-xs text-white"
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
        className="flex flex-wrap gap-1 border-b border-[var(--wb-gold-line)] px-2 py-2"
        aria-label="信息流筛选"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`wb-tab ${filter === f.key ? "" : "hover:bg-white/5"}`}
          >
            {f.label}
          </button>
        ))}
      </nav>

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          className="h-full space-y-2 overflow-y-auto px-3 py-2"
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
            className="absolute bottom-2 left-1/2 min-h-9 -translate-x-1/2 rounded-full bg-[var(--wb-gold)] px-3 text-xs font-bold text-[#1c1610] shadow"
          >
            有 {unread} 条新消息 ↓
          </button>
        )}
      </div>
    </section>
  );
}
