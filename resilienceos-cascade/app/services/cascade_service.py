"""Cascade service — manages the infrastructure graph lifecycle and
exposes high-level operations to the API layer.

This is the single point of coordination between graph building,
validation, and cascade simulation.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import networkx as nx

from app.core.graph_builder import GraphBuilder
from app.core.cascade_engine import CascadeEngine
from app.models.enums import ValidationErrorCode
from app.models.schemas import (
    Asset,
    AssetState,
    CascadeResult,
    Dependency,
    ErrorDetail,
    GraphBuildRequest,
    GraphBuildResponse,
    GraphEdgeInfo,
    GraphInfo,
    GraphNodeInfo,
    GraphValidationWarning,
    ScenarioInput,
)


class CascadeService:
    """Stateful service managing the infrastructure graph and simulations."""

    def __init__(self) -> None:
        self._builder: Optional[GraphBuilder] = None
        self._graph: Optional[nx.DiGraph] = None

    @property
    def graph(self) -> Optional[nx.DiGraph]:
        return self._graph

    @property
    def is_loaded(self) -> bool:
        return self._graph is not None and self._graph.number_of_nodes() > 0

    # ── Graph lifecycle ──────────────────────────────────────────────

    def build_graph(self, request: GraphBuildRequest) -> GraphBuildResponse:
        """Build and validate the infrastructure graph."""
        self._builder = GraphBuilder()
        response = self._builder.build(
            request.assets, request.dependencies, request.states
        )
        self._graph = self._builder.graph
        return response

    def load_from_files(
        self,
        assets_path: str | Path,
        dependencies_path: str | Path,
        states_path: Optional[str | Path] = None,
    ) -> GraphBuildResponse:
        """Load graph data from JSON files on disk."""
        assets_path = Path(assets_path)
        dependencies_path = Path(dependencies_path)

        with open(assets_path, "r", encoding="utf-8") as f:
            raw_assets = json.load(f)
        with open(dependencies_path, "r", encoding="utf-8") as f:
            raw_deps = json.load(f)

        assets = [Asset(**a) for a in raw_assets]
        deps = [Dependency(**d) for d in raw_deps]

        states: list[AssetState] = []
        if states_path:
            sp = Path(states_path)
            if sp.exists():
                with open(sp, "r", encoding="utf-8") as f:
                    raw_states = json.load(f)
                states = [AssetState(**s) for s in raw_states]

        request = GraphBuildRequest(
            assets=assets, dependencies=deps, states=states
        )
        return self.build_graph(request)

    def get_graph_info(self) -> GraphInfo | ErrorDetail:
        """Return full graph inspection data."""
        if not self.is_loaded:
            return ErrorDetail(
                code=ValidationErrorCode.GRAPH_VALIDATION_FAILED,
                message="No graph has been loaded. POST to /api/v1/graph first.",
            )

        g = self._graph
        nodes: list[GraphNodeInfo] = []
        for nid in g.nodes:
            asset: Asset = g.nodes[nid]["asset"]
            nodes.append(
                GraphNodeInfo(
                    asset_id=nid,
                    asset_type=asset.asset_type,
                    name=asset.name,
                    criticality=asset.criticality,
                    status=g.nodes[nid].get("status", "OPERATIONAL").value
                    if hasattr(g.nodes[nid].get("status", ""), "value")
                    else str(g.nodes[nid].get("status", "OPERATIONAL")),
                    in_degree=g.in_degree(nid),
                    out_degree=g.out_degree(nid),
                    capacity=asset.capacity,
                    current_load=asset.current_load,
                )
            )

        edges: list[GraphEdgeInfo] = []
        for u, v, data in g.edges(data=True):
            dep = data.get("dependency")
            edges.append(
                GraphEdgeInfo(
                    dependency_id=data.get("dependency_id", ""),
                    source=u,
                    target=v,
                    dependency_type=data.get("dependency_type", ""),
                    required_capacity=data.get("required_capacity", 0),
                    dependency_strength=data.get("dependency_strength", 1.0),
                    critical=data.get("critical", True),
                )
            )

        return GraphInfo(
            node_count=g.number_of_nodes(),
            edge_count=g.number_of_edges(),
            nodes=nodes,
            edges=edges,
        )

    # ── Cascade simulation ───────────────────────────────────────────

    def simulate(self, scenario: ScenarioInput) -> CascadeResult | ErrorDetail:
        """Run a cascade simulation against the loaded graph.

        Returns
        -------
        CascadeResult | ErrorDetail
        """
        if not self.is_loaded:
            return ErrorDetail(
                code=ValidationErrorCode.GRAPH_VALIDATION_FAILED,
                message="No graph has been loaded. POST to /api/v1/graph first.",
            )

        # Validate that all root failures reference real assets
        for failure in scenario.root_failures:
            if failure.asset_id not in self._graph:
                return ErrorDetail(
                    code=ValidationErrorCode.ASSET_NOT_FOUND,
                    message=f"Asset '{failure.asset_id}' does not exist in the loaded graph.",
                )

        engine = CascadeEngine(self._graph)
        return engine.run(scenario)


# Module-level singleton
_service: Optional[CascadeService] = None


def get_cascade_service() -> CascadeService:
    """Return the module-level singleton CascadeService."""
    global _service
    if _service is None:
        _service = CascadeService()
    return _service
