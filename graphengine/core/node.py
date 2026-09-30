"""
Core Node definitions for GraphEngine.
Represents computational tasks and operators in the NetworkX DAG.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Union
from pydantic import BaseModel, ConfigDict, Field


class NodeStatus(str, Enum):
    PENDING = "PENDING"
    READY = "READY"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    CANCELLED = "CANCELLED"


class NodeResult(BaseModel):
    """Execution output and telemetry for a single node."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    node_id: str
    status: NodeStatus
    output: Any = None
    error: Optional[str] = None
    execution_time_ms: float = 0.0
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    cached: bool = False
    retries_attempted: int = 0


class Node:
    """
    A computational node in the GraphEngine DAG.
    Encapsulates synchronous or asynchronous execution logic, retry policies,
    timeouts, and conditional evaluation.
    """

    def __init__(
        self,
        node_id: str,
        func: Optional[Callable[..., Any]] = None,
        name: Optional[str] = None,
        description: str = "",
        inputs: Optional[List[str]] = None,
        output_key: Optional[str] = None,
        retries: int = 0,
        retry_delay_seconds: float = 0.5,
        timeout_seconds: Optional[float] = None,
        condition: Optional[Callable[[Dict[str, Any]], bool]] = None,
        cacheable: bool = False,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.node_id = str(node_id)
        self.name = name or self.node_id
        self.description = description
        self.func = func
        self.inputs = inputs or []
        self.output_key = output_key or self.node_id
        self.retries = max(0, retries)
        self.retry_delay_seconds = retry_delay_seconds
        self.timeout_seconds = timeout_seconds
        self.condition = condition
        self.cacheable = cacheable
        self.metadata = metadata or {}
        self.is_async = inspect.iscoroutinefunction(func) if func else False
        # GraphEngine association for DSL bitwise operator (>>)
        self._graph_engine = None

        # Inspect signature for smart parameter filtering
        self._accepts_var_keyword = False
        self._accepted_params: Set[str] = set()
        if func is not None:
            try:
                sig = inspect.signature(func)
                for param in sig.parameters.values():
                    if param.kind == inspect.Parameter.VAR_KEYWORD:
                        self._accepts_var_keyword = True
                        break
                    elif param.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY):
                        self._accepted_params.add(param.name)
            except (ValueError, TypeError):
                self._accepts_var_keyword = True

    def __rshift__(self, other: Union[Node, List[Node]]) -> Union[Node, List[Node]]:
        """
        Connect self >> other. Automatically adds edge if engine is attached.
        Example: node_a >> node_b >> [node_c, node_d]
        """
        engine = getattr(self, "_graph_engine", None)
        targets = other if isinstance(other, list) else [other]
        for t in targets:
            eng = engine or getattr(t, "_graph_engine", None)
            if eng and hasattr(t, "node_id"):
                eng.add_edge(self.node_id, t.node_id)
        return other

    def __lshift__(self, other: Union[Node, List[Node]]) -> Node:
        """Connect self << other (i.e. other -> self dependency)."""
        sources = other if isinstance(other, list) else [other]
        engine = getattr(self, "_graph_engine", None)
        for s in sources:
            eng = engine or getattr(s, "_graph_engine", None)
            if eng and hasattr(s, "node_id"):
                eng.add_edge(s.node_id, self.node_id)
        return self

    def can_run(self, state: Dict[str, Any]) -> bool:
        """Evaluate if node should run given current graph state."""
        if self.condition is None:
            return True
        try:
            return bool(self.condition(state))
        except Exception:
            return False

    async def execute_async(self, kwargs: Dict[str, Any]) -> NodeResult:
        """Execute node function asynchronously with retries, timeout, and telemetry."""
        start_t = time.perf_counter()
        abs_start = time.time()
        retries_left = self.retries
        retries_done = 0

        # Filter arguments to match callable signature if not accepting **kwargs
        if self.func is not None and not self._accepts_var_keyword:
            call_kwargs = {k: v for k, v in kwargs.items() if k in self._accepted_params}
        else:
            call_kwargs = dict(kwargs)

        while True:
            try:
                if self.func is None:
                    # Passthrough / identity node
                    output = kwargs
                elif self.is_async:
                    if self.timeout_seconds:
                        output = await asyncio.wait_for(self.func(**call_kwargs), timeout=self.timeout_seconds)
                    else:
                        output = await self.func(**call_kwargs)
                else:
                    # Run sync function in thread pool to avoid blocking async loop
                    loop = asyncio.get_running_loop()
                    if self.timeout_seconds:
                        output = await asyncio.wait_for(
                            loop.run_in_executor(None, lambda: self.func(**call_kwargs)),
                            timeout=self.timeout_seconds
                        )
                    else:
                        output = await loop.run_in_executor(None, lambda: self.func(**call_kwargs))

                end_t = time.perf_counter()
                return NodeResult(
                    node_id=self.node_id,
                    status=NodeStatus.COMPLETED,
                    output=output,
                    execution_time_ms=round((end_t - start_t) * 1000, 2),
                    start_time=abs_start,
                    end_time=time.time(),
                    retries_attempted=retries_done,
                )

            except Exception as exc:
                if retries_left > 0:
                    retries_left -= 1
                    retries_done += 1
                    if self.retry_delay_seconds > 0:
                        await asyncio.sleep(self.retry_delay_seconds)
                    continue

                end_t = time.perf_counter()
                return NodeResult(
                    node_id=self.node_id,
                    status=NodeStatus.FAILED,
                    error=str(exc),
                    execution_time_ms=round((end_t - start_t) * 1000, 2),
                    start_time=abs_start,
                    end_time=time.time(),
                    retries_attempted=retries_done,
                )

    def execute_sync(self, kwargs: Dict[str, Any]) -> NodeResult:
        """Run synchronously using asyncio.run if in sync context."""
        try:
            loop = asyncio.get_running_loop()
            # If already running inside an active loop (e.g. jupyter), execute directly
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(lambda: asyncio.run(self.execute_async(kwargs)))
                return future.result()
        except RuntimeError:
            return asyncio.run(self.execute_async(kwargs))

    def to_dict(self) -> Dict[str, Any]:
        """Serialize node metadata for visualization and API."""
        return {
            "id": self.node_id,
            "name": self.name,
            "description": self.description,
            "inputs": self.inputs,
            "output_key": self.output_key,
            "is_async": self.is_async,
            "retries": self.retries,
            "timeout_seconds": self.timeout_seconds,
            "cacheable": self.cacheable,
            "metadata": self.metadata,
        }

    def __repr__(self) -> str:
        return f"<Node id={self.node_id!r} name={self.name!r} async={self.is_async}>"
