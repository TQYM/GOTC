/**
 * SSE 客户端（05 §3.3 / 02 §4）：用 fetch 流式读取而非原生 EventSource，
 * 以便完全掌控重连节奏——断开后每 2s 重连一次，并带 `Last-Event-ID` 头让后端补发断线期间事件。
 * 后端缓冲溢出时会先推快照（phase_change + tick），前端照常消费即可。
 */
import type { ConnState, StreamEvent, StreamHandlers } from "@/lib/api/cityApi";
import { withBase } from "@/lib/api/base";

export const RECONNECT_MS = 2000;

interface Frame {
  id: string | null;
  event: string;
  data: string;
}

/** 增量解析 text/event-stream：返回完整帧，剩余半帧留在 buffer */
export function parseFrames(buffer: string): { frames: Frame[]; rest: string } {
  const frames: Frame[] = [];
  const normalized = buffer.replace(/\r\n?/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let id: string | null = null;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue; // 注释 / ping
      const i = line.indexOf(":");
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "id") id = value;
      else if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) frames.push({ id, event, data: data.join("\n") });
  }
  return { frames, rest };
}

export function openEventStream(
  url: string,
  { onEvent, onConn }: StreamHandlers,
): () => void {
  let closed = false;
  let lastId: string | null = null;
  let downSince: number | null = null;
  let ctrl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setConn = (s: ConnState) => {
    if (s === "down" && downSince === null) downSince = Date.now();
    if (s === "open") downSince = null;
    onConn(s, downSince);
  };

  const connect = async () => {
    if (closed) return;
    ctrl = new AbortController();
    setConn(downSince === null ? "connecting" : "down");
    try {
      const res = await fetch(withBase(url), {
        headers: {
          Accept: "text/event-stream",
          ...(lastId ? { "Last-Event-ID": lastId } : {}),
        },
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      setConn("open");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { frames, rest } = parseFrames(buf);
        buf = rest;
        for (const f of frames) {
          if (f.id !== null) lastId = f.id;
          let data: unknown;
          try {
            data = JSON.parse(f.data);
          } catch {
            continue;
          }
          const id = f.id === null ? null : Number(f.id);
          onEvent({
            id: Number.isFinite(id) ? id : null,
            event: f.event,
            data,
          } as StreamEvent);
        }
      }
    } catch {
      /* 断开：下面统一进入重连 */
    }
    if (closed) return;
    setConn("down");
    timer = setTimeout(connect, RECONNECT_MS);
  };

  void connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    ctrl?.abort();
  };
}
