"""
Event system for GraphEngine execution lifecycle.
Enables real-time progress monitoring, logging, and web streaming (SSE/WebSockets).
"""

from __future__ import annotations

import asyncio
from enum import Enum
from typing import Any, Callable, Dict, List, Optional
from pydantic import BaseModel


class GraphEventType(str, Enum):
    GRAPH_START = "graph:start"
    GRAPH_COMPLETE = "graph:complete"
    GRAPH_FAILED = "graph:failed"
    NODE_QUEUED = "node:queued"
    NODE_START = "node:start"
    NODE_SUCCESS = "node:success"
    NODE_FAILED = "node:failed"
    NODE_SKIPPED = "node:skipped"
    EDGE_TRAVERSED = "edge:traversed"
    LOG = "log"


class GraphEvent(BaseModel):
    """Event payload emitted during execution."""
    event_type: GraphEventType
    graph_id: str
    run_id: str
    timestamp: float
    node_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class EventEmitter:
    """Manages synchronous and asynchronous subscribers to graph execution events."""

    def __init__(self):
        self._async_listeners: List[Callable[[GraphEvent], Any]] = []
        self._sync_listeners: List[Callable[[GraphEvent], None]] = []
        self._queues: List[asyncio.Queue[GraphEvent]] = []

    def on(self, callback: Callable[[GraphEvent], Any]):
        """Register a callback for all graph events."""
        if asyncio.iscoroutinefunction(callback):
            self._async_listeners.append(callback)
        else:
            self._sync_listeners.append(callback)

    def create_event_queue(self) -> asyncio.Queue[GraphEvent]:
        """Create a real-time async queue (used by SSE / WebSocket stream)."""
        queue: asyncio.Queue[GraphEvent] = asyncio.Queue()
        self._queues.append(queue)
        return queue

    def remove_event_queue(self, queue: asyncio.Queue[GraphEvent]):
        """Unsubscribe an async queue."""
        if queue in self._queues:
            self._queues.remove(queue)

    async def emit_async(self, event: GraphEvent):
        """Emit event to all async/sync listeners and active stream queues."""
        # Deliver to stream queues
        for queue in list(self._queues):
            try:
                queue.put_nowait(event)
            except Exception:
                pass

        # Call async listeners
        for listener in self._async_listeners:
            try:
                res = listener(event)
                if asyncio.iscoroutine(res):
                    await res
            except Exception:
                pass

        # Call sync listeners
        for listener in self._sync_listeners:
            try:
                listener(event)
            except Exception:
                pass

    def emit_sync(self, event: GraphEvent):
        """Synchronous wrapper for event emission."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.emit_async(event))
        except RuntimeError:
            for listener in self._sync_listeners:
                try:
                    listener(event)
                except Exception:
                    pass
