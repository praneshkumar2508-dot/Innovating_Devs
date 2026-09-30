"""
Unit tests for parallel concurrency in GraphEngine.
Verifies that nodes within the same generation execute concurrently.
"""

import asyncio
import time
import pytest
from graphengine.core.engine import GraphEngine


@pytest.mark.asyncio
async def test_parallel_async_execution():
    engine = GraphEngine("concurrency_test")

    # Three independent async tasks, each taking 0.1 seconds
    async def worker_1():
        await asyncio.sleep(0.1)
        return {"w1": 1}

    async def worker_2():
        await asyncio.sleep(0.1)
        return {"w2": 2}

    async def worker_3():
        await asyncio.sleep(0.1)
        return {"w3": 3}

    async def join_workers(w1: int, w2: int, w3: int):
        return {"total": w1 + w2 + w3}

    engine.add_node("w1", worker_1)
    engine.add_node("w2", worker_2)
    engine.add_node("w3", worker_3)
    engine.add_node("join", join_workers)

    engine.add_edge("w1", "join")
    engine.add_edge("w2", "join")
    engine.add_edge("w3", "join")

    start_t = time.perf_counter()
    ctx = await engine.run_async()
    elapsed = time.perf_counter() - start_t

    assert ctx.status == "COMPLETED"
    assert ctx.get_output("join") == {"total": 6}

    # If executed sequentially, total time would be >= 0.3s.
    # Concurrent execution runs all three in parallel, completing in < 0.25s!
    assert elapsed < 0.25, f"Expected parallel execution in < 0.25s, but took {elapsed:.2f}s"
