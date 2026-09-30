"""
Unit tests for conditional routing and branching in GraphEngine.
"""

from graphengine.core.engine import GraphEngine
from graphengine.core.node import NodeStatus


def test_conditional_branching():
    engine = GraphEngine("branch_test")

    engine.add_node("router", lambda flag: {"flag": flag})
    engine.add_node("branch_true", lambda: {"result": "TRUE_PATH"})
    engine.add_node("branch_false", lambda: {"result": "FALSE_PATH"})
    engine.add_node("collector", lambda result: {"final": result})

    # Conditional Edges
    engine.add_edge(
        "router",
        "branch_true",
        condition=lambda out: out.get("flag") is True,
    )
    engine.add_edge(
        "router",
        "branch_false",
        condition=lambda out: out.get("flag") is False,
    )
    engine.add_edge("branch_true", "collector")
    engine.add_edge("branch_false", "collector")

    # Run with flag=True
    ctx_true = engine.run({"flag": True})
    assert ctx_true.status == "COMPLETED"
    assert ctx_true.node_results["branch_true"].status == NodeStatus.COMPLETED
    assert ctx_true.node_results["branch_false"].status == NodeStatus.SKIPPED
    assert ctx_true.get_output("collector") == {"final": "TRUE_PATH"}

    # Run with flag=False
    ctx_false = engine.run({"flag": False})
    assert ctx_false.status == "COMPLETED"
    assert ctx_false.node_results["branch_true"].status == NodeStatus.SKIPPED
    assert ctx_false.node_results["branch_false"].status == NodeStatus.COMPLETED
    assert ctx_false.get_output("collector") == {"final": "FALSE_PATH"}


def test_node_level_condition():
    engine = GraphEngine("node_condition_test")

    engine.add_node(
        "premium_feature",
        lambda: {"unlocked": True},
        condition=lambda state: state.get("is_premium") is True,
    )

    # Standard run: should be skipped
    ctx1 = engine.run({"is_premium": False})
    assert ctx1.node_results["premium_feature"].status == NodeStatus.SKIPPED

    # Premium run: should execute
    ctx2 = engine.run({"is_premium": True})
    assert ctx2.node_results["premium_feature"].status == NodeStatus.COMPLETED
    assert ctx2.get_output("premium_feature") == {"unlocked": True}
