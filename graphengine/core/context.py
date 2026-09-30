"""
ExecutionContext and StateStore for GraphEngine.
Holds run metadata, node execution results, and shared graph state.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field
from graphengine.core.node import NodeResult, NodeStatus


class ExecutionContext(BaseModel):
    """
    State and output container for a single execution run of a graph.
    """
    model_config = ConfigDict(arbitrary_types_allowed=True)

    run_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    graph_id: str = "default_graph"
    initial_state: Dict[str, Any] = Field(default_factory=dict)
    state: Dict[str, Any] = Field(default_factory=dict)
    node_results: Dict[str, NodeResult] = Field(default_factory=dict)
    execution_order: List[str] = Field(default_factory=list)
    start_time: float = Field(default_factory=time.time)
    end_time: Optional[float] = None
    total_duration_ms: float = 0.0
    status: str = "PENDING"
    error: Optional[str] = None

    def initialize(self, graph_id: str, initial_state: Optional[Dict[str, Any]] = None):
        self.graph_id = graph_id
        self.initial_state = dict(initial_state or {})
        self.state = dict(self.initial_state)
        self.start_time = time.time()
        self.status = "RUNNING"

    def record_result(self, node_id: str, result: NodeResult):
        """Record the outcome of a node execution into the context."""
        self.node_results[node_id] = result
        if node_id not in self.execution_order:
            self.execution_order.append(node_id)

        # Update shared state if successful
        if result.status == NodeStatus.COMPLETED and result.output is not None:
            # If output is a dictionary, merge into state
            if isinstance(result.output, dict):
                self.state.update(result.output)
            # Also store under node_id key
            self.state[node_id] = result.output

    def get_output(self, node_id: str, default: Any = None) -> Any:
        """Get output value for a specific node."""
        res = self.node_results.get(node_id)
        if res and res.status == NodeStatus.COMPLETED:
            return res.output
        return default

    def get_result(self, node_id: str) -> Optional[NodeResult]:
        """Get complete NodeResult for a node."""
        return self.node_results.get(node_id)

    def finalize(self, success: bool = True, error: Optional[str] = None):
        """Finalize the run context."""
        self.end_time = time.time()
        self.total_duration_ms = round((self.end_time - self.start_time) * 1000, 2)
        self.status = "COMPLETED" if success else "FAILED"
        self.error = error

    def is_success(self) -> bool:
        return self.status == "COMPLETED"

    def to_summary_dict(self) -> Dict[str, Any]:
        """Summary dictionary suitable for JSON responses and logging."""
        return {
            "run_id": self.run_id,
            "graph_id": self.graph_id,
            "status": self.status,
            "total_duration_ms": self.total_duration_ms,
            "nodes_executed": len(self.execution_order),
            "execution_order": self.execution_order,
            "node_statuses": {
                nid: res.status.value for nid, res in self.node_results.items()
            },
            "error": self.error,
            "outputs": {
                nid: res.output for nid, res in self.node_results.items()
                if res.status == NodeStatus.COMPLETED
            },
            "final_state": self.state,
        }
