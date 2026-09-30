"""Criticality engine — calculates criticality-weighted impact for each
asset based on its criticality score from input data.

Criticality is NEVER hard-coded — it comes from the asset definition.
"""

from __future__ import annotations

from dataclasses import dataclass

import networkx as nx

from app.models.enums import CascadeAssetState
from app.models.schemas import Asset
from app.core.propagation_engine import PropagationResult


@dataclass
class CriticalityDetail:
    """Criticality analysis for a single asset."""
    asset_id: str
    criticality: float = 0.0
    state: CascadeAssetState = CascadeAssetState.OPERATIONAL
    is_critical_service: bool = False
    criticality_weighted_loss: float = 0.0


class CriticalityEngine:
    """Evaluates criticality across the infrastructure graph."""

    # Threshold above which an asset is considered a "critical service"
    CRITICAL_SERVICE_THRESHOLD = 0.8

    def __init__(self, graph: nx.DiGraph) -> None:
        self.graph = graph

    def analyse(
        self,
        propagation: PropagationResult,
    ) -> dict[str, CriticalityDetail]:
        """Calculate criticality metrics for all affected assets.

        Parameters
        ----------
        propagation : PropagationResult
            Cascade propagation result.

        Returns
        -------
        dict[str, CriticalityDetail]
        """
        details: dict[str, CriticalityDetail] = {}

        for node_id in self.graph.nodes:
            asset: Asset = self.graph.nodes[node_id]["asset"]
            state = propagation.asset_states.get(node_id, CascadeAssetState.OPERATIONAL)

            detail = CriticalityDetail(
                asset_id=node_id,
                criticality=asset.criticality,
                state=state,
                is_critical_service=asset.criticality >= self.CRITICAL_SERVICE_THRESHOLD,
            )

            # Criticality-weighted loss:
            #   0 if operational, criticality × (1 - capacity_pct/100) otherwise
            if state == CascadeAssetState.OPERATIONAL:
                detail.criticality_weighted_loss = 0.0
            elif state == CascadeAssetState.FAILED:
                detail.criticality_weighted_loss = asset.criticality
            else:
                cap_pct = propagation.capacity_remaining.get(node_id, 100.0)
                detail.criticality_weighted_loss = asset.criticality * (1.0 - cap_pct / 100.0)

            details[node_id] = detail

        return details

    def count_critical_at_risk(
        self,
        details: dict[str, CriticalityDetail],
    ) -> int:
        """Count how many critical services are at risk or worse."""
        return sum(
            1
            for d in details.values()
            if d.is_critical_service
            and d.state
            in (
                CascadeAssetState.AT_RISK,
                CascadeAssetState.DEGRADED,
                CascadeAssetState.FAILED,
            )
        )
