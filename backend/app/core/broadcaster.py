"""每会话 SSE broadcaster（06 §4）：200 条环形缓冲 + 活跃订阅 + 断点补发。

事件 id 单调递增；溢出后 replay_after 返回 None，由调用方改发全量快照重置前端。
"""

import asyncio
import json
from collections import deque
from dataclasses import dataclass

SSE_BUFFER_CAPACITY = 200  # 06 §4：内存缓冲最近 200 条


@dataclass
class BufferedEvent:
    id: int
    event: str
    data: dict

    def sse_frame(self) -> dict[str, str]:
        return {
            "id": str(self.id),
            "event": self.event,
            "data": json.dumps(self.data, ensure_ascii=False),
        }


class Broadcaster:
    def __init__(self, capacity: int = SSE_BUFFER_CAPACITY) -> None:
        self._buffer: deque[BufferedEvent] = deque(maxlen=capacity)
        self._next_id = 1
        self._subscribers: set[asyncio.Queue[BufferedEvent]] = set()

    @property
    def latest_id(self) -> int:
        return self._next_id - 1

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def history(self) -> list[dict]:
        return [{"id": e.id, "event": e.event, "data": e.data} for e in self._buffer]

    def publish(self, event: str, data: dict) -> int:
        entry = BufferedEvent(id=self._next_id, event=event, data=data)
        self._next_id += 1
        self._buffer.append(entry)
        for queue in list(self._subscribers):
            queue.put_nowait(entry)  # 无界队列：慢消费者不拖垮广播（断线重连走补发）
        return entry.id

    def replay_after(self, last_id: int) -> list[BufferedEvent] | None:
        """补发 last_id 之后的事件；已溢出（最旧 id > last_id+1）返回 None → 快照恢复。"""
        if not self._buffer:
            return []
        if last_id + 1 < self._buffer[0].id:
            return None
        return [entry for entry in self._buffer if entry.id > last_id]

    def subscribe(self) -> asyncio.Queue[BufferedEvent]:
        queue: asyncio.Queue[BufferedEvent] = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[BufferedEvent]) -> None:
        self._subscribers.discard(queue)
