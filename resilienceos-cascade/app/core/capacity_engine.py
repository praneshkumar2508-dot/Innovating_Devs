"""Capacity engine — analyses available vs. required capacity for every
asset in the dependency graph after failures are applied.

This engine identifies capacity shortfalls and surplus, enabling
downstream engines to determine which services can be sustained.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import networkx as nx

from app.models.enums import CascadeAssetState
from app.models.schemas import Asset, Dependency
from app.core.propagation_engine import PropagationResult


@dataclass
class CapacityDetail:
    """Capacity analysis for a single asset."""
    asset_id: str
    total_required: float = 0.0
    total_available: float = 0.0
    shortfall: float = 0.0
    surplus: float = 0.0
    capacity_unit: str = ""
    # Per-supplier breakdown
    supplier_contributions: dict[str, float] = field(default_factory=dict)


class CapacityEngine:
    """Analyses capacity constraints across the infrastructure graph."""

    def __init__(self, graph: nx.DiGraph) -> None:
        self.graph = graph

    def analyse(
        self,
        propagation: PropagationResult,
    ) -> dict[str, CapacityDetail]:
        """Calculate capacity details for every affected asset.

        Parameters
        ----------
        propagation : PropagationResult
            Result of the cascade propagation.

        Returns
        -------
        dict[str, CapacityDetail]
            Mapping of asset_id → CapacityDetail.
        """
        details: dict[str, CapacityDetail] = {}

        for node_id in self.graph.nodes:
            asset: Asset = self.graph.nodes[node_id]["asset"]

            detail = CapacityDetail(asset_id=node_id)

            # Determine required capacity from incoming edges
            total_required = 0.0
            total_available = 0.0
            cap_unit = ""

            for pred_id in self.graph.predecessors(node_id):
                edge_data = self.graph.edges[pred_id, node_id]
                dep: Dependency = edge_data["dependency"]

                if dep.required_capacity > 0:
                    total_required += dep.required_capacity
                    cap_unit = dep.capacity_unit or cap_unit

                    # How much can this supplier actually provide?
                    supplier_cap_pct = propagation.capacity_remaining.get(pred_id, 100.0)
                    supplier_state = propagation.asset_states.get(
                        pred_id, CascadeAssetState.OPERATIONAL
                    )

                    supplier_asset: Asset = self.graph.nodes[pred_id]["asset"]

                    if supplier_state == CascadeAssetState.FAILED:
                        contribution = 0.0
                    elif supplier_asset.capacity and supplier_asset.current_load:
                        # Spare capacity = total capacity * remaining_pct - current_load
                        total_cap = supplier_asset.capacity.value * (supplier_cap_pct / 100.0)
                        cur_load = supplier_asset.current_load.value
                        # But we need to account for OTHER dependents too
                        # The contribution is limited by the edge's required capacity
                        spare = max(total_cap - cur_load, 0.0)
                        contribution = min(spare, dep.required_capacity)
                    else:
                        # No capacity data — assume proportional availability
                        contribution = dep.required_capacity * (supplier_cap_pct / 100.0)

                    total_available += contribution
                    detail.supplier_contributions[pred_id] = contribution

            detail.total_required = total_required
            detail.total_available = total_available
            detail.shortfall = max(total_required - total_available, 0.0)
            detail.surplus = max(total_available - total_required, 0.0)
            detail.capacity_unit = cap_unit

            details[node_id] = detail

        return details

    def get_spare_capacity(
        self,
        supplier_id: str,
        propagation: PropagationResult,
    ) -> float:
        """Return the spare capacity of a supplier asset.

        Spare = (total capacity × remaining_pct/100) − current_load.
        """
        if supplier_id not in self.graph:
            return 0.0

        supplier_asset: Asset = self.graph.nodes[supplier_id]["asset"]
        supplier_cap_pct = propagation.capacity_remaining.get(supplier_id, 100.0)
        supplier_state = propagation.asset_states.get(
            supplier_id, CascadeAssetState.OPERATIONAL
        )

        if supplier_state == CascadeAssetState.FAILED:
            return 0.0

        if supplier_asset.capacity and supplier_asset.current_load:
            total_cap = supplier_asset.capacity.value * (supplier_cap_pct / 100.0)
            cur_load = supplier_asset.current_load.value
            return max(total_cap - cur_load, 0.0)
        elif supplier_asset.capacity:
            return supplier_asset.capacity.value * (supplier_cap_pct / 100.0)
        else:
            return 0.0
