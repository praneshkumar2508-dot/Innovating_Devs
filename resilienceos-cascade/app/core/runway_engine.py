"""Runway engine — calculates how long backup resources last for each
affected asset.

Produces a timeline of backup-exhaustion events so ResilienceOS can
answer "what fails next?" rather than just "what is connected?".
"""

from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx

from app.models.enums import CascadeAssetState
from app.models.schemas import Asset, TimelineEvent
from app.core.propagation_engine import PropagationResult


@dataclass
class RunwayDetail:
    """Runway information for a single asset."""
    asset_id: str
    has_backup: bool = False
    backup_type: str = ""
    runway_minutes: float = 0.0
    backup_capacity: float = 0.0
    consumption_rate: float = 0.0


class RunwayEngine:
    """Calculates backup runway and generates timeline events."""

    def __init__(self, graph: nx.DiGraph) -> None:
        self.graph = graph

    def analyse(
        self,
        propagation: PropagationResult,
    ) -> tuple[dict[str, RunwayDetail], list[TimelineEvent]]:
        """Calculate runway for every affected asset with a backup.

        Parameters
        ----------
        propagation : PropagationResult
            Output of the propagation engine.

        Returns
        -------
        tuple[dict[str, RunwayDetail], list[TimelineEvent]]
            (asset_id → RunwayDetail, sorted timeline events)
        """
        runways: dict[str, RunwayDetail] = {}
        events: list[TimelineEvent] = []

        for node_id in self.graph.nodes:
            asset: Asset = self.graph.nodes[node_id]["asset"]
            state = propagation.asset_states.get(node_id, CascadeAssetState.OPERATIONAL)

            # Only compute runway for non-operational assets
            if state == CascadeAssetState.OPERATIONAL:
                continue

            detail = RunwayDetail(asset_id=node_id)

            if asset.backup:
                detail.has_backup = True
                detail.backup_type = asset.backup.type
                detail.backup_capacity = asset.backup.capacity

                if asset.backup.consumption_rate and asset.backup.consumption_rate > 0:
                    # Variable consumption
                    # Runway = fuel_minutes * (rated_capacity / actual_load)
                    # If actual load is unknown, use rated consumption
                    detail.consumption_rate = asset.backup.consumption_rate
                    detail.runway_minutes = (
                        asset.backup.capacity / asset.backup.consumption_rate
                    )
                else:
                    # Fixed duration
                    detail.runway_minutes = asset.backup.fuel_minutes
                    if asset.backup.fuel_minutes > 0:
                        detail.consumption_rate = (
                            asset.backup.capacity / asset.backup.fuel_minutes
                        )

                # Update propagation state
                if detail.runway_minutes > 0:
                    if state in (CascadeAssetState.FAILED, CascadeAssetState.AT_RISK):
                        # Asset has backup → it's protected (for now) or at risk
                        propagation.asset_states[node_id] = CascadeAssetState.AT_RISK
                        propagation.capacity_remaining[node_id] = min(
                            (detail.backup_capacity / max(asset.capacity.value, 1.0)) * 100.0
                            if asset.capacity else 100.0,
                            100.0,
                        )

                    # Generate timeline events
                    events.append(
                        TimelineEvent(
                            time_minutes=0,
                            asset_id=node_id,
                            event=f"{node_id}_BACKUP_ACTIVATED",
                            details=f"Backup ({detail.backup_type}) activated. "
                                    f"Runway: {detail.runway_minutes:.0f} minutes.",
                        )
                    )
                    events.append(
                        TimelineEvent(
                            time_minutes=detail.runway_minutes,
                            asset_id=node_id,
                            event=f"{node_id}_BACKUP_EXHAUSTED",
                            details=f"Backup ({detail.backup_type}) exhausted after "
                                    f"{detail.runway_minutes:.0f} minutes.",
                        )
                    )

            runways[node_id] = detail

        # Sort events by time
        events.sort(key=lambda e: e.time_minutes)

        return runways, events

    def compute_time_cascade(
        self,
        propagation: PropagationResult,
        runways: dict[str, RunwayDetail],
        simulation_minutes: float = 480,
    ) -> list[TimelineEvent]:
        """Generate a full time-based cascade timeline.

        When a backup exhausts, the asset fails, which may trigger
        further downstream impacts.

        Parameters
        ----------
        propagation : PropagationResult
        runways : dict[str, RunwayDetail]
        simulation_minutes : float
            Maximum simulation horizon.

        Returns
        -------
        list[TimelineEvent]
        """
        events: list[TimelineEvent] = []

        # Root failure events at t=0
        for aid, depth in propagation.propagation_order:
            if depth == 0:
                events.append(
                    TimelineEvent(
                        time_minutes=0,
                        asset_id=aid,
                        event=f"{aid}_FAILED",
                        details="Root failure.",
                    )
                )

        # Backup activations and exhaustions
        for aid, runway in runways.items():
            if not runway.has_backup or runway.runway_minutes <= 0:
                continue

            events.append(
                TimelineEvent(
                    time_minutes=0,
                    asset_id=aid,
                    event=f"{aid}_BACKUP_ACTIVATED",
                    details=f"Backup ({runway.backup_type}) activated.",
                )
            )

            exhaust_time = runway.runway_minutes
            if exhaust_time <= simulation_minutes:
                events.append(
                    TimelineEvent(
                        time_minutes=exhaust_time,
                        asset_id=aid,
                        event=f"{aid}_BACKUP_EXHAUSTED",
                        details=f"Backup ({runway.backup_type}) exhausted.",
                    )
                )
                # When backup exhausts, downstream assets may be affected
                for succ in self.graph.successors(aid):
                    succ_state = propagation.asset_states.get(
                        succ, CascadeAssetState.OPERATIONAL
                    )
                    if succ_state not in (CascadeAssetState.FAILED,):
                        events.append(
                            TimelineEvent(
                                time_minutes=exhaust_time,
                                asset_id=succ,
                                event=f"{succ}_AT_RISK",
                                details=f"Upstream backup at {aid} exhausted.",
                            )
                        )

        events.sort(key=lambda e: (e.time_minutes, e.asset_id))

        # Deduplicate
        seen = set()
        unique: list[TimelineEvent] = []
        for ev in events:
            key = (ev.time_minutes, ev.asset_id, ev.event)
            if key not in seen:
                seen.add(key)
                unique.append(ev)

        return unique
