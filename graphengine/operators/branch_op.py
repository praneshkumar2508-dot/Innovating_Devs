"""
Branch and Routing operators for GraphEngine.
Allows dynamic decision making and routing flow to specific downstream nodes.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional
from graphengine.core.node import Node


class BranchNode(Node):
    """
    Evaluates an input payload and determines which branch key to activate.
    Downstream edges can check for the active branch key.
    """

    def __init__(
        self,
        node_id: str,
        selector_func: Callable[..., str],
        name: Optional[str] = None,
        description: str = "Selects downstream branch based on input",
        inputs: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        async def _branch_wrapper(**kwargs) -> Dict[str, Any]:
            if asyncio.iscoroutinefunction(selector_func):
                selected = await selector_func(**kwargs)
            else:
                selected = selector_func(**kwargs)
            return {"active_branch": str(selected), "data": kwargs}

        import asyncio
        super().__init__(
            node_id=node_id,
            func=_branch_wrapper,
            name=name or f"Branch:{node_id}",
            description=description,
            inputs=inputs,
            metadata=metadata,
        )
