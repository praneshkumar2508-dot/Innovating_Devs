"""
Map and Reduce operators for processing collections concurrently in GraphEngine.
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Any, Callable, Dict, List, Optional
from graphengine.core.node import Node


class MapReduceNode(Node):
    """
    Applies a mapping function to each item in a list concurrently,
    then optionally aggregates/reduces the results.
    """

    def __init__(
        self,
        node_id: str,
        map_fn: Callable[[Any], Any],
        reduce_fn: Optional[Callable[[List[Any]], Any]] = None,
        items_key: str = "items",
        concurrency_limit: int = 10,
        name: Optional[str] = None,
        description: str = "Concurrently maps and reduces items",
        retries: int = 0,
        timeout_seconds: Optional[float] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.map_fn = map_fn
        self.reduce_fn = reduce_fn
        self.items_key = items_key
        self.concurrency_limit = concurrency_limit

        async def _map_reduce_runner(**kwargs) -> Dict[str, Any]:
            items = kwargs.get(self.items_key, [])
            if not isinstance(items, list):
                raise TypeError(f"Expected list under key '{self.items_key}', got {type(items).__name__}")

            semaphore = asyncio.Semaphore(self.concurrency_limit)
            is_async = inspect.iscoroutinefunction(self.map_fn)

            async def _process_item(item):
                async with semaphore:
                    if is_async:
                        return await self.map_fn(item)
                    else:
                        loop = asyncio.get_running_loop()
                        return await loop.run_in_executor(None, self.map_fn, item)

            mapped_results = await asyncio.gather(*[_process_item(it) for it in items])

            final_output = mapped_results
            if self.reduce_fn:
                if inspect.iscoroutinefunction(self.reduce_fn):
                    final_output = await self.reduce_fn(mapped_results)
                else:
                    final_output = self.reduce_fn(mapped_results)

            return {
                "mapped": mapped_results,
                "count": len(items),
                "reduced": final_output,
            }

        super().__init__(
            node_id=node_id,
            func=_map_reduce_runner,
            name=name or f"MapReduce:{node_id}",
            description=description,
            inputs=[items_key],
            retries=retries,
            timeout_seconds=timeout_seconds,
            metadata=metadata,
        )
