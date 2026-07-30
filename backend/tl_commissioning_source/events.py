"""WebSocket event hub. Broadcasts pattern, health, session and fault
updates to the control UI and the kiosk page (§10, WS /api/v1/events)."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any


class EventHub:
    def __init__(self) -> None:
        self._queues: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        async with self._lock:
            self._queues.add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue) -> None:
        async with self._lock:
            self._queues.discard(queue)

    async def publish(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        message = json.dumps(
            {
                "type": event_type,
                "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
                "payload": payload or {},
            }
        )
        async with self._lock:
            queues = list(self._queues)
        for queue in queues:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # Slow consumer: drop oldest so live status keeps flowing.
                try:
                    queue.get_nowait()
                    queue.put_nowait(message)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

    def publish_soon(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        """Publish from sync code already running inside the event loop."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self.publish(event_type, payload))
