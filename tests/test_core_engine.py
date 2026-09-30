"""
Unit tests for GraphEngine core functionality:
DAG construction, execution, cycle detection, retries, and caching.
"""

import time
import pytest
from graphengine.core.engine import GraphCycleError, GraphEngine, NodeNotFoundError
from graphengine.core.node import Node, NodeStatus


def test_basic_linear_execution():
    engine = GraphEngine("linear_test")

    def step_a():
        return {"val": 10}

    def step_b(val: int):
        return {"val": val * 2}

    def step_c(val: int):
        return {"result": val + 5}

    engine.add_node("a", step_a)
    engine.add_node("b", step_b)
    engine.add_node("c", step_c)

    engine.add_edge("a", "b")
    engine.add_edge("b", "c")

    ctx = engine.run()
    assert ctx.status == "COMPLETED"
    assert ctx.execution_order == ["a", "b", "c"]
    assert ctx.get_output("c") == {"result": 25}


def test_cycle_detection():
    engine = GraphEngine("cycle_test")
    engine.add_node("x", lambda: 1)
    engine.add_node("y", lambda: 2)
    engine.add_node("z", lambda: 3)

    engine.add_edge("x", "y")
    engine.add_edge("y", "z")
    engine.add_edge("z", "x")  # Cycle!

    assert engine.is_dag() is False
    with pytest.raises(GraphCycleError):
        engine.run()


def test_node_retry_policy():
    engine = GraphEngine("retry_test")
    attempts = 0

    def flaky_task():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise RuntimeError("Transient failure")
        return {"success": True, "attempts": attempts}

    engine.add_node("flaky", flaky_task, retries=3, retry_delay_seconds=0.01)

    ctx = engine.run()
    assert ctx.status == "COMPLETED"
    assert attempts == 3
    assert ctx.get_output("flaky")["success"] is True


def test_node_caching():
    engine = GraphEngine("cache_test", enable_cache=True)
    counter = 0

    def expensive_calc(x: int):
        nonlocal counter
        counter += 1
        return {"squared": x * x}

    engine.add_node("calc", expensive_calc, cacheable=True)

    # First run
    ctx1 = engine.run({"x": 5})
    assert ctx1.get_output("calc") == {"squared": 25}
    assert counter == 1

    # Second run with same input should hit cache
    ctx2 = engine.run({"x": 5})
    assert ctx2.get_output("calc") == {"squared": 25}
    assert ctx2.node_results["calc"].cached is True
    assert counter == 1  # Not incremented!


def test_node_not_found():
    engine = GraphEngine("missing_test")
    engine.add_node("a", lambda: 1)

    with pytest.raises(NodeNotFoundError):
        engine.add_edge("a", "non_existent")


def test_topological_generations():
    engine = GraphEngine("topo_test")
    for nid in ["a", "b1", "b2", "c"]:
        engine.add_node(nid, lambda: nid)

    engine.add_edge("a", "b1")
    engine.add_edge("a", "b2")
    engine.add_edge("b1", "c")
    engine.add_edge("b2", "c")

    generations = engine.get_parallel_generations()
    assert len(generations) == 3
    assert generations[0] == ["a"]
    assert set(generations[1]) == {"b1", "b2"}
    assert generations[2] == ["c"]
