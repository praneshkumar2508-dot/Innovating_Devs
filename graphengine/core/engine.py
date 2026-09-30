"""
GraphEngine: High-performance DAG computation and workflow engine built on NetworkX.
Provides parallel generation-based scheduling, conditional branching, data mapping,
node memoization, lifecycle events, and topological validation.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any, Callable, Dict, Iterator, List, Optional, Set, Tuple, Union
import networkx as nx

from graphengine.core.cache import NodeCache
from graphengine.core.context import ExecutionContext
from graphengine.core.edge import Edge
from graphengine.core.events import EventEmitter, GraphEvent, GraphEventType
from graphengine.core.node import Node, NodeResult, NodeStatus


class GraphCycleError(ValueError):
    """Raised when the graph contains cycles and is not a valid DAG."""
    def __init__(self, cycles: List[List[str]]):
        self.cycles = cycles
        super().__init__(f"Graph contains cycles: {cycles}. GraphEngine requires a Directed Acyclic Graph (DAG).")


class NodeNotFoundError(KeyError):
    """Raised when a specified node does not exist in the graph."""
    pass


class GraphEngine:
    """
    DAG execution engine powered by NetworkX DiGraph.
    Manages node dependencies, dataflow routing, parallel scheduling, and execution state.
    """

    def __init__(
        self,
        graph_id: Optional[str] = None,
        name: Optional[str] = None,
        description: str = "",
        enable_cache: bool = True,
        cache_size: int = 1000,
        stop_on_failure: bool = True,
    ):
        self.graph_id = graph_id or f"graph_{uuid.uuid4().hex[:8]}"
        self.name = name or self.graph_id
        self.description = description
        self.stop_on_failure = stop_on_failure

        # Underlying NetworkX DiGraph
        self._graph: nx.DiGraph = nx.DiGraph(graph_id=self.graph_id, name=self.name)

        # Caching & Events
        self.enable_cache = enable_cache
        self.cache = NodeCache(max_entries=cache_size) if enable_cache else None
        self.events = EventEmitter()

        # Metadata
        self.created_at = time.time()

    @property
    def nx_graph(self) -> nx.DiGraph:
        """Direct access to the underlying NetworkX DiGraph."""
        return self._graph

    # --------------------------------------------------------------------------
    # Graph Construction & Modification
    # --------------------------------------------------------------------------

    def add_node(
        self,
        node_or_id: Union[Node, str],
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
    ) -> Node:
        """Add a computational node to the graph."""
        if isinstance(node_or_id, Node):
            node = node_or_id
        else:
            node = Node(
                node_id=node_or_id,
                func=func,
                name=name,
                description=description,
                inputs=inputs,
                output_key=output_key,
                retries=retries,
                retry_delay_seconds=retry_delay_seconds,
                timeout_seconds=timeout_seconds,
                condition=condition,
                cacheable=cacheable,
                metadata=metadata,
            )

        node._graph_engine = self
        self._graph.add_node(node.node_id, obj=node)
        return node

    def add_edge(
        self,
        source: str,
        target: str,
        data_mapping: Optional[Dict[str, str]] = None,
        condition: Optional[Callable[[Any], bool]] = None,
        label: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Edge:
        """
        Add a directed dependency edge from source node to target node.
        Ensures both nodes exist in the graph.
        """
        if source not in self._graph:
            raise NodeNotFoundError(f"Source node '{source}' not found in graph.")
        if target not in self._graph:
            raise NodeNotFoundError(f"Target node '{target}' not found in graph.")

        edge = Edge(
            source=source,
            target=target,
            data_mapping=data_mapping,
            condition=condition,
            label=label,
            metadata=metadata,
        )
        self._graph.add_edge(source, target, edge_obj=edge)
        return edge

    def get_node(self, node_id: str) -> Node:
        """Retrieve node object by ID."""
        if node_id not in self._graph:
            raise NodeNotFoundError(f"Node '{node_id}' not found.")
        return self._graph.nodes[node_id]["obj"]

    def get_edge(self, source: str, target: str) -> Optional[Edge]:
        """Retrieve edge object between two nodes."""
        if self._graph.has_edge(source, target):
            return self._graph.edges[source, target].get("edge_obj")
        return None

    def remove_node(self, node_id: str):
        """Remove a node and all incident edges from the graph."""
        if node_id in self._graph:
            self._graph.remove_node(node_id)

    # --------------------------------------------------------------------------
    # NetworkX Analysis & Validation
    # --------------------------------------------------------------------------

    def validate_dag(self):
        """
        Validate that graph is a Directed Acyclic Graph (DAG) using NetworkX.
        Raises GraphCycleError if cycles are detected.
        """
        if not nx.is_directed_acyclic_graph(self._graph):
            cycles = list(nx.simple_cycles(self._graph))
            raise GraphCycleError(cycles)

    def is_dag(self) -> bool:
        """Check if graph is a valid DAG."""
        return nx.is_directed_acyclic_graph(self._graph)

    def get_topological_sort(self) -> List[str]:
        """Return a topological order of nodes using NetworkX."""
        self.validate_dag()
        return list(nx.topological_sort(self._graph))

    def get_parallel_generations(self) -> List[List[str]]:
        """
        Return groups of nodes that can be executed concurrently in parallel.
        Uses NetworkX topological_generations algorithm.
        """
        self.validate_dag()
        return [list(gen) for gen in nx.topological_generations(self._graph)]

    def get_upstream_dependencies(self, node_id: str) -> Set[str]:
        """Return all transitive upstream ancestor nodes required by node_id."""
        return nx.ancestors(self._graph, node_id)

    def get_downstream_dependents(self, node_id: str) -> Set[str]:
        """Return all transitive downstream descendant nodes affected by node_id."""
        return nx.descendants(self._graph, node_id)

    def get_critical_path(self, source: str, target: str) -> List[str]:
        """Find the shortest or critical path between source and target."""
        return nx.shortest_path(self._graph, source=source, target=target)

    # --------------------------------------------------------------------------
    # Execution Engine (Parallel Async & Synchronous)
    # --------------------------------------------------------------------------

    def _prepare_node_inputs(
        self,
        node: Node,
        context: ExecutionContext,
    ) -> Tuple[Dict[str, Any], bool]:
        """
        Collect inputs for node from predecessor outputs and initial state.
        Supports converging conditional branches (runs if at least one incoming edge is valid).
        Returns: (kwargs_dict, is_traversable_boolean)
        """
        kwargs: Dict[str, Any] = {}
        predecessors = list(self._graph.predecessors(node.node_id))

        if not predecessors:
            # Root node: populate from initial state or context
            needed_params = set(node.inputs)
            if hasattr(node, "_accepted_params") and node._accepted_params:
                needed_params.update(node._accepted_params)
            for param in needed_params:
                if param in context.state:
                    kwargs[param] = context.state[param]
            return kwargs, True

        at_least_one_traversable = False
        for pred_id in predecessors:
            pred_result = context.get_result(pred_id)
            if not pred_result or pred_result.status != NodeStatus.COMPLETED:
                continue

            edge = self.get_edge(pred_id, node.node_id)
            if edge:
                if not edge.is_traversable(pred_result.output):
                    continue
                mapped_data = edge.transform_data(pred_result.output)
                kwargs.update(mapped_data)
                at_least_one_traversable = True
            else:
                if isinstance(pred_result.output, dict):
                    kwargs.update(pred_result.output)
                else:
                    kwargs[pred_id] = pred_result.output
                at_least_one_traversable = True

        # Fallback to context state for any remaining declared/accepted parameters
        needed_params = set(node.inputs)
        if hasattr(node, "_accepted_params") and node._accepted_params:
            needed_params.update(node._accepted_params)
        for param in needed_params:
            if param not in kwargs and param in context.state:
                kwargs[param] = context.state[param]

        return kwargs, at_least_one_traversable

    async def _execute_single_node(
        self,
        node_id: str,
        context: ExecutionContext,
    ) -> NodeResult:
        """Execute a single node, handling caching, inputs, and events."""
        node = self.get_node(node_id)

        # 1. Condition check against current state
        if not node.can_run(context.state):
            result = NodeResult(
                node_id=node_id,
                status=NodeStatus.SKIPPED,
                error="Condition evaluated to False",
            )
            context.record_result(node_id, result)
            await self.events.emit_async(GraphEvent(
                event_type=GraphEventType.NODE_SKIPPED,
                graph_id=self.graph_id,
                run_id=context.run_id,
                timestamp=time.time(),
                node_id=node_id,
                message=f"Node {node_id} skipped due to condition.",
            ))
            return result

        # 2. Gather inputs
        kwargs, traversable = self._prepare_node_inputs(node, context)

        # If has predecessors but not traversable (e.g. conditional branch blocked)
        predecessors = list(self._graph.predecessors(node_id))
        if predecessors and not traversable:
            result = NodeResult(
                node_id=node_id,
                status=NodeStatus.SKIPPED,
                error="Upstream branch condition not met",
            )
            context.record_result(node_id, result)
            await self.events.emit_async(GraphEvent(
                event_type=GraphEventType.NODE_SKIPPED,
                graph_id=self.graph_id,
                run_id=context.run_id,
                timestamp=time.time(),
                node_id=node_id,
                message=f"Node {node_id} skipped: upstream condition not satisfied.",
            ))
            return result

        # 3. Check Cache
        if self.enable_cache and node.cacheable and self.cache:
            cached_result = self.cache.get(node_id, kwargs)
            if cached_result:
                context.record_result(node_id, cached_result)
                await self.events.emit_async(GraphEvent(
                    event_type=GraphEventType.NODE_SUCCESS,
                    graph_id=self.graph_id,
                    run_id=context.run_id,
                    timestamp=time.time(),
                    node_id=node_id,
                    data={"output": cached_result.output, "cached": True},
                    message=f"Node {node_id} retrieved from cache.",
                ))
                return cached_result

        # 4. Emit Start Event
        await self.events.emit_async(GraphEvent(
            event_type=GraphEventType.NODE_START,
            graph_id=self.graph_id,
            run_id=context.run_id,
            timestamp=time.time(),
            node_id=node_id,
            data={"inputs": {k: str(v)[:100] for k, v in kwargs.items()}},
            message=f"Node {node_id} started execution.",
        ))

        # 5. Execute Node
        result = await node.execute_async(kwargs)
        context.record_result(node_id, result)

        # 6. Save Cache if applicable
        if self.enable_cache and node.cacheable and self.cache and result.status == NodeStatus.COMPLETED:
            self.cache.set(node_id, kwargs, result)

        # 7. Emit Success/Failure Event
        if result.status == NodeStatus.COMPLETED:
            await self.events.emit_async(GraphEvent(
                event_type=GraphEventType.NODE_SUCCESS,
                graph_id=self.graph_id,
                run_id=context.run_id,
                timestamp=time.time(),
                node_id=node_id,
                data={
                    "output": result.output,
                    "duration_ms": result.execution_time_ms,
                    "retries": result.retries_attempted,
                },
                message=f"Node {node_id} completed successfully in {result.execution_time_ms}ms.",
            ))
        else:
            await self.events.emit_async(GraphEvent(
                event_type=GraphEventType.NODE_FAILED,
                graph_id=self.graph_id,
                run_id=context.run_id,
                timestamp=time.time(),
                node_id=node_id,
                data={"error": result.error, "duration_ms": result.execution_time_ms},
                message=f"Node {node_id} failed: {result.error}",
            ))

        return result

    async def run_async(
        self,
        initial_state: Optional[Dict[str, Any]] = None,
        context: Optional[ExecutionContext] = None,
    ) -> ExecutionContext:
        """
        Execute the entire DAG asynchronously.
        Executes independent nodes concurrently within each topological generation.
        """
        self.validate_dag()

        if context is None:
            context = ExecutionContext()
        context.initialize(self.graph_id, initial_state)

        await self.events.emit_async(GraphEvent(
            event_type=GraphEventType.GRAPH_START,
            graph_id=self.graph_id,
            run_id=context.run_id,
            timestamp=time.time(),
            data={"node_count": self._graph.number_of_nodes()},
            message=f"Graph '{self.name}' execution started.",
        ))

        # Retrieve topological generations (layers of nodes that can run concurrently)
        generations = self.get_parallel_generations()
        has_failure = False
        error_msg = None

        for gen_idx, generation in enumerate(generations):
            # Run all nodes in the current generation in parallel
            tasks = [self._execute_single_node(nid, context) for nid in generation]
            results: List[NodeResult] = await asyncio.gather(*tasks)

            for res in results:
                if res.status == NodeStatus.FAILED:
                    has_failure = True
                    error_msg = f"Node '{res.node_id}' failed: {res.error}"
                    if self.stop_on_failure:
                        break

            if has_failure and self.stop_on_failure:
                break

        context.finalize(success=not has_failure, error=error_msg)

        final_event = GraphEventType.GRAPH_COMPLETE if not has_failure else GraphEventType.GRAPH_FAILED
        await self.events.emit_async(GraphEvent(
            event_type=final_event,
            graph_id=self.graph_id,
            run_id=context.run_id,
            timestamp=time.time(),
            data=context.to_summary_dict(),
            message=f"Graph '{self.name}' finished with status {context.status}.",
        ))

        return context

    def run(
        self,
        initial_state: Optional[Dict[str, Any]] = None,
        context: Optional[ExecutionContext] = None,
    ) -> ExecutionContext:
        """Synchronously execute the DAG."""
        try:
            loop = asyncio.get_running_loop()
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(lambda: asyncio.run(self.run_async(initial_state, context)))
                return future.result()
        except RuntimeError:
            return asyncio.run(self.run_async(initial_state, context))

    # --------------------------------------------------------------------------
    # Subgraph & Export
    # --------------------------------------------------------------------------

    def subgraph_for(self, target_nodes: List[str]) -> "GraphEngine":
        """
        Extract a minimal subgraph containing only the target nodes and their
        ancestor dependencies necessary to execute them.
        """
        needed: Set[str] = set()
        for tn in target_nodes:
            if tn not in self._graph:
                raise NodeNotFoundError(f"Node '{tn}' not in graph.")
            needed.add(tn)
            needed.update(nx.ancestors(self._graph, tn))

        sub_nx = self._graph.subgraph(needed).copy()
        new_engine = GraphEngine(
            graph_id=f"{self.graph_id}_subgraph",
            name=f"Subgraph of {self.name}",
            enable_cache=self.enable_cache,
            stop_on_failure=self.stop_on_failure,
        )
        new_engine._graph = sub_nx
        return new_engine

    def to_dict(self) -> Dict[str, Any]:
        """Export graph definition and layout structure for visualization & API."""
        nodes = []
        for nid, data in self._graph.nodes(data=True):
            node_obj: Node = data["obj"]
            nodes.append(node_obj.to_dict())

        edges = []
        for u, v, data in self._graph.edges(data=True):
            edge_obj: Edge = data.get("edge_obj")
            if edge_obj:
                edges.append(edge_obj.to_dict())
            else:
                edges.append({"source": u, "target": v, "data_mapping": {}})

        return {
            "graph_id": self.graph_id,
            "name": self.name,
            "description": self.description,
            "node_count": self._graph.number_of_nodes(),
            "edge_count": self._graph.number_of_edges(),
            "is_dag": self.is_dag(),
            "generations": self.get_parallel_generations() if self.is_dag() else [],
            "nodes": nodes,
            "edges": edges,
        }

    def __repr__(self) -> str:
        return (
            f"<GraphEngine id={self.graph_id!r} "
            f"nodes={self._graph.number_of_nodes()} "
            f"edges={self._graph.number_of_edges()}>"
        )
