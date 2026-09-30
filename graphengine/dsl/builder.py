"""
Fluent DSL and decorator utilities for constructing GraphEngine workflows.
Supports decorator syntax and bitwise shift syntax: `node_a >> node_b >> [node_c, node_d]`.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Union
from graphengine.core.engine import GraphEngine
from graphengine.core.node import Node


class PipelineBuilder:
    """
    Fluent builder wrapper around GraphEngine.
    Provides decorators, chain linking, and convenience functions.
    """

    def __init__(self, name: str = "pipeline", description: str = "", enable_cache: bool = True):
        self.engine = GraphEngine(
            graph_id=name.lower().replace(" ", "_"),
            name=name,
            description=description,
            enable_cache=enable_cache,
        )

    def node(
        self,
        node_id: Optional[str] = None,
        name: Optional[str] = None,
        depends_on: Optional[Union[str, List[str]]] = None,
        inputs: Optional[List[str]] = None,
        retries: int = 0,
        timeout_seconds: Optional[float] = None,
        cacheable: bool = False,
        condition: Optional[Callable[[Dict[str, Any]], bool]] = None,
    ):
        """
        Decorator to register a function directly as a graph node.

        Example:
            @pipeline.node(depends_on="load_data")
            def transform(data):
                return data.strip()
        """
        def decorator(func: Callable[..., Any]):
            nid = node_id or func.__name__
            node_name = name or func.__name__

            n = self.engine.add_node(
                node_or_id=nid,
                func=func,
                name=node_name,
                description=func.__doc__ or "",
                inputs=inputs,
                retries=retries,
                timeout_seconds=timeout_seconds,
                cacheable=cacheable,
                condition=condition,
            )

            # Wire up dependencies if specified
            if depends_on:
                deps = [depends_on] if isinstance(depends_on, str) else depends_on
                for dep in deps:
                    self.engine.add_edge(dep, nid)

            return n

        return decorator

    def connect(
        self,
        source: Union[str, Node, List[Union[str, Node]]],
        target: Union[str, Node, List[Union[str, Node]]],
        data_mapping: Optional[Dict[str, str]] = None,
        condition: Optional[Callable[[Any], bool]] = None,
        label: Optional[str] = None,
    ):
        """Connect source node(s) to target node(s)."""
        sources = [source] if not isinstance(source, list) else source
        targets = [target] if not isinstance(target, list) else target

        for s in sources:
            s_id = s.node_id if isinstance(s, Node) else str(s)
            for t in targets:
                t_id = t.node_id if isinstance(t, Node) else str(t)
                self.engine.add_edge(
                    source=s_id,
                    target=t_id,
                    data_mapping=data_mapping,
                    condition=condition,
                    label=label,
                )

    def run(self, initial_state: Optional[Dict[str, Any]] = None):
        """Run pipeline synchronously."""
        return self.engine.run(initial_state)

    async def run_async(self, initial_state: Optional[Dict[str, Any]] = None):
        """Run pipeline asynchronously."""
        return await self.engine.run_async(initial_state)
