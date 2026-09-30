"""Graph builder — constructs and validates a NetworkX DiGraph from raw
infrastructure data.

The graph is data-driven: new asset types and dependency types are
accepted without any code changes.
"""

from __future__ import annotations

from typing import Optional

import networkx as nx

from app.config import settings
from app.models.enums import AssetStatus, ValidationErrorCode
from app.models.schemas import (
    Asset,
    AssetState,
    Dependency,
    GraphBuildResponse,
    GraphValidationWarning,
)


class GraphBuilder:
    """Builds and validates a NetworkX DiGraph from infrastructure data."""

    def __init__(self) -> None:
        self.graph: nx.DiGraph = nx.DiGraph()
        self._assets: dict[str, Asset] = {}
        self._dependencies: dict[str, Dependency] = {}

    # ── public API ───────────────────────────────────────────────────────

    def build(
        self,
        assets: list[Asset],
        dependencies: list[Dependency],
        states: Optional[list[AssetState]] = None,
    ) -> GraphBuildResponse:
        """Build the graph and return validation results.

        Parameters
        ----------
        assets : list[Asset]
            Infrastructure assets to add as nodes.
        dependencies : list[Dependency]
            Directed dependency edges.
        states : list[AssetState] | None
            Optional runtime state overrides.

        Returns
        -------
        GraphBuildResponse
        """
        self.graph = nx.DiGraph()
        self._assets = {}
        self._dependencies = {}
        warnings: list[GraphValidationWarning] = []

        # 1. Add assets as nodes
        for asset in assets:
            self._assets[asset.asset_id] = asset
            self.graph.add_node(
                asset.asset_id,
                asset=asset,
                status=asset.status,
                capacity_available_percent=100.0,
            )

        # 2. Apply state overrides
        if states:
            for st in states:
                if st.asset_id in self.graph:
                    self.graph.nodes[st.asset_id]["status"] = st.status
                    self.graph.nodes[st.asset_id][
                        "capacity_available_percent"
                    ] = st.capacity_available_percent
                else:
                    warnings.append(
                        GraphValidationWarning(
                            code=ValidationErrorCode.ASSET_NOT_FOUND,
                            message=f"State references unknown asset '{st.asset_id}'.",
                            related_ids=[st.asset_id],
                        )
                    )

        # 3. Add dependencies as edges
        warnings.extend(self._add_edges(dependencies))

        # 4. Validate
        warnings.extend(self._validate())

        # 5. Detect cycles
        cycles = self._detect_cycles()

        # 6. Detect isolated assets
        isolated = self._detect_isolated()

        return GraphBuildResponse(
            node_count=self.graph.number_of_nodes(),
            edge_count=self.graph.number_of_edges(),
            warnings=warnings,
            cycles_detected=cycles,
            isolated_assets=isolated,
        )

    def get_asset(self, asset_id: str) -> Optional[Asset]:
        """Return the Asset model for a node, or None."""
        data = self.graph.nodes.get(asset_id)
        if data is None:
            return None
        return data.get("asset")

    # ── private helpers ──────────────────────────────────────────────────

    def _add_edges(self, dependencies: list[Dependency]) -> list[GraphValidationWarning]:
        warnings: list[GraphValidationWarning] = []
        seen_ids: set[str] = set()

        for dep in dependencies:
            # Duplicate dependency ID
            if dep.dependency_id in seen_ids:
                warnings.append(
                    GraphValidationWarning(
                        code=ValidationErrorCode.DUPLICATE_DEPENDENCY_ID,
                        message=f"Duplicate dependency ID '{dep.dependency_id}'.",
                        related_ids=[dep.dependency_id],
                    )
                )
            seen_ids.add(dep.dependency_id)

            # Source exists?
            if dep.source_asset not in self.graph:
                warnings.append(
                    GraphValidationWarning(
                        code=ValidationErrorCode.ASSET_NOT_FOUND,
                        message=f"Dependency '{dep.dependency_id}' references unknown source '{dep.source_asset}'.",
                        related_ids=[dep.dependency_id, dep.source_asset],
                    )
                )
                continue

            # Target exists?
            if dep.target_asset not in self.graph:
                warnings.append(
                    GraphValidationWarning(
                        code=ValidationErrorCode.ASSET_NOT_FOUND,
                        message=f"Dependency '{dep.dependency_id}' references unknown target '{dep.target_asset}'.",
                        related_ids=[dep.dependency_id, dep.target_asset],
                    )
                )
                continue

            # Invalid capacity?
            if dep.required_capacity < 0:
                warnings.append(
                    GraphValidationWarning(
                        code=ValidationErrorCode.INVALID_CAPACITY,
                        message=f"Dependency '{dep.dependency_id}' has negative required_capacity.",
                        related_ids=[dep.dependency_id],
                    )
                )

            self._dependencies[dep.dependency_id] = dep
            self.graph.add_edge(
                dep.source_asset,
                dep.target_asset,
                dependency=dep,
                dependency_id=dep.dependency_id,
                dependency_type=dep.dependency_type,
                required_capacity=dep.required_capacity,
                capacity_unit=dep.capacity_unit,
                dependency_strength=dep.dependency_strength,
                critical=dep.critical,
                failure_threshold=dep.failure_threshold,
            )

        return warnings

    def _validate(self) -> list[GraphValidationWarning]:
        """Run validation checks on the completed graph."""
        warnings: list[GraphValidationWarning] = []

        for node_id in self.graph.nodes:
            asset: Asset = self.graph.nodes[node_id]["asset"]

            # Criticality range
            if not 0 <= asset.criticality <= 1:
                warnings.append(
                    GraphValidationWarning(
                        code=ValidationErrorCode.INVALID_CRITICALITY,
                        message=f"Asset '{node_id}' criticality {asset.criticality} outside [0,1].",
                        related_ids=[node_id],
                    )
                )

        return warnings

    def _detect_cycles(self) -> list[list[str]]:
        """Return a list of simple cycles in the graph.

        Cycles are reported but NOT treated as errors — real infrastructure
        can have interdependencies.
        """
        try:
            cycles = list(nx.simple_cycles(self.graph))
            # Limit the number of reported cycles to avoid flooding
            return [list(c) for c in cycles[:50]]
        except Exception:
            return []

    def _detect_isolated(self) -> list[str]:
        """Return asset IDs that have no incoming or outgoing dependencies."""
        return [
            n
            for n in self.graph.nodes
            if self.graph.in_degree(n) == 0 and self.graph.out_degree(n) == 0
        ]
