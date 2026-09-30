"""Cascade engine — the central orchestrator that runs all sub-engines
in sequence and assembles the final CascadeResult.

Pipeline:
  1. Propagation Engine  → BFS cascade, state, depth, paths
  2. Capacity Engine     → capacity shortfalls / surplus
  3. Redundancy Engine   → alternative supplies, PROTECTED upgrades
  4. Runway Engine       → backup durations, timeline events
  5. Criticality Engine  → criticality-weighted impact
  6. Impact Engine       → normalised impact scores, ranking
  7. R₀ / depth / population → final summary metrics
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

import networkx as nx

from app.models.enums import CascadeAssetState, FailureMode
from app.models.schemas import (
    AffectedAsset,
    AlternativeSupply,
    CascadeResult,
    CascadeSummary,
    FailureSpec,
    ScenarioInput,
    TimelineEvent,
    Asset,
)
from app.core.propagation_engine import PropagationEngine, PropagationResult
from app.core.capacity_engine import CapacityEngine
from app.core.redundancy_engine import RedundancyEngine
from app.core.runway_engine import RunwayEngine
from app.core.criticality_engine import CriticalityEngine
from app.core.impact_engine import ImpactEngine


class CascadeEngine:
    """Orchestrates the full cascade analysis pipeline."""

    def __init__(self, graph: nx.DiGraph) -> None:
        self.graph = graph

    def run(self, scenario: ScenarioInput) -> CascadeResult:
        """Execute the full cascade analysis.

        Parameters
        ----------
        scenario : ScenarioInput
            The failure scenario to simulate.

        Returns
        -------
        CascadeResult
            Complete structured analysis result.
        """
        # ── 1. Propagation ───────────────────────────────────────────
        prop_engine = PropagationEngine(self.graph)
        propagation = prop_engine.propagate(scenario.root_failures)

        # ── 2. Capacity ─────────────────────────────────────────────
        cap_engine = CapacityEngine(self.graph)
        capacity_details = cap_engine.analyse(propagation)

        # ── 3. Redundancy ───────────────────────────────────────────
        red_engine = RedundancyEngine(self.graph)
        alternatives = red_engine.analyse(propagation)
        propagation = red_engine.update_states_with_redundancy(
            propagation, alternatives
        )

        # ── 3b. Capacity-aware refinement ───────────────────────────
        # Refine PROTECTED states based on actual spare capacity.
        # If an asset is PROTECTED but no alternative supplier has enough
        # spare capacity, downgrade to AT_RISK.
        self._refine_with_capacity(propagation, alternatives, cap_engine)

        # ── 4. Runway ───────────────────────────────────────────────
        run_engine = RunwayEngine(self.graph)
        runways, _backup_events = run_engine.analyse(propagation)
        timeline = run_engine.compute_time_cascade(
            propagation,
            runways,
            simulation_minutes=scenario.simulation_time_minutes,
        )

        # ── 5. Criticality ──────────────────────────────────────────
        crit_engine = CriticalityEngine(self.graph)
        criticality_details = crit_engine.analyse(propagation)
        critical_at_risk = crit_engine.count_critical_at_risk(criticality_details)

        # ── 6. Impact ───────────────────────────────────────────────
        imp_engine = ImpactEngine(self.graph)
        impact_details = imp_engine.analyse(propagation, runways)
        ranked = imp_engine.rank(impact_details)

        # ── 7. Assemble result ──────────────────────────────────────
        root_ids = [f.asset_id for f in scenario.root_failures]
        affected_assets = self._build_affected_assets(
            propagation, runways, alternatives, impact_details,
            capacity_details, root_ids,
        )

        # Summary metrics
        summary = self._build_summary(
            propagation, affected_assets, critical_at_risk, root_ids,
        )

        scenario_id = scenario.scenario_id or f"SIM_{uuid.uuid4().hex[:8].upper()}"

        return CascadeResult(
            scenario_id=scenario_id,
            root_failures=root_ids,
            analysis_timestamp=datetime.now(timezone.utc),
            summary=summary,
            affected_assets=affected_assets,
            timeline=timeline,
        )

    # ── Private helpers ──────────────────────────────────────────────

    def _build_affected_assets(
        self,
        propagation: PropagationResult,
        runways: dict,
        alternatives: dict,
        impact_details: dict,
        capacity_details: dict,
        root_ids: list[str],
    ) -> list[AffectedAsset]:
        """Build the AffectedAsset list from engine outputs."""
        affected: list[AffectedAsset] = []

        for node_id in self.graph.nodes:
            state = propagation.asset_states.get(node_id, CascadeAssetState.OPERATIONAL)

            # Include asset if it's a root, non-operational, has cascade paths,
            # or has alternative supplies (was evaluated during propagation)
            has_paths = len(propagation.cascade_paths.get(node_id, [])) > 0
            has_alts = len(alternatives.get(node_id, [])) > 0
            is_root = node_id in root_ids
            if state == CascadeAssetState.OPERATIONAL and not is_root and not has_paths and not has_alts:
                continue

            asset: Asset = self.graph.nodes[node_id]["asset"]
            imp = impact_details.get(node_id)
            runway_info = runways.get(node_id)
            alt_list = alternatives.get(node_id, [])
            cap_detail = capacity_details.get(node_id)

            # Dependency satisfaction
            dep_sat: dict[str, float] = {}
            for pred_id in self.graph.predecessors(node_id):
                edge_data = self.graph.edges[pred_id, node_id]
                dep_type = edge_data["dependency_type"]
                pred_state = propagation.asset_states.get(
                    pred_id, CascadeAssetState.OPERATIONAL
                )
                if pred_state == CascadeAssetState.FAILED:
                    sat = 0.0
                else:
                    sat = propagation.capacity_remaining.get(pred_id, 100.0) / 100.0
                # Take minimum satisfaction if multiple suppliers of same type
                if dep_type in dep_sat:
                    dep_sat[dep_type] = max(dep_sat[dep_type], sat)
                else:
                    dep_sat[dep_type] = sat

            # Population impact
            pop_affected = None
            if asset.population_served and state in (
                CascadeAssetState.FAILED,
                CascadeAssetState.AT_RISK,
                CascadeAssetState.DEGRADED,
            ):
                pop_affected = asset.population_served

            aa = AffectedAsset(
                asset_id=node_id,
                name=asset.name,
                asset_type=asset.asset_type,
                state=state,
                impact_score=imp.impact_score if imp else 0.0,
                impact_severity=imp.severity if imp else "LOW",
                runway_minutes=runway_info.runway_minutes if runway_info and runway_info.has_backup else None,
                criticality=asset.criticality,
                cascade_depth=propagation.cascade_depth.get(node_id, 0),
                capacity_available_percent=propagation.capacity_remaining.get(node_id, 100.0),
                population_affected=pop_affected,
                paths=propagation.cascade_paths.get(node_id, []),
                alternative_supplies=alt_list,
                dependency_satisfaction=dep_sat,
                backup_active=runway_info.has_backup if runway_info else False,
            )
            affected.append(aa)

        # Sort by impact score descending
        affected.sort(key=lambda a: a.impact_score, reverse=True)
        return affected

    def _build_summary(
        self,
        propagation: PropagationResult,
        affected_assets: list[AffectedAsset],
        critical_at_risk: int,
        root_ids: list[str],
    ) -> CascadeSummary:
        """Calculate summary metrics."""
        states = propagation.asset_states

        n_affected = len(affected_assets)
        n_failed = sum(1 for a in affected_assets if a.state == CascadeAssetState.FAILED)
        n_at_risk = sum(1 for a in affected_assets if a.state == CascadeAssetState.AT_RISK)
        n_protected = sum(1 for a in affected_assets if a.state == CascadeAssetState.PROTECTED)
        n_degraded = sum(1 for a in affected_assets if a.state == CascadeAssetState.DEGRADED)

        # Cascade depth = max depth across all affected
        max_depth = 0
        for a in affected_assets:
            if a.cascade_depth > max_depth:
                max_depth = a.cascade_depth

        # Infrastructure Failure R₀
        # = total direct downstream state-changes / number of root failures
        r0 = self._calculate_r0(propagation, root_ids)

        # Population affected (sum, but note about double-counting)
        total_pop: int | None = None
        for a in affected_assets:
            if a.population_affected is not None:
                if total_pop is None:
                    total_pop = 0
                total_pop += a.population_affected

        return CascadeSummary(
            assets_affected=n_affected,
            assets_failed=n_failed,
            assets_at_risk=n_at_risk,
            assets_protected=n_protected,
            assets_degraded=n_degraded,
            cascade_depth=max_depth,
            failure_r0=r0,
            critical_services_at_risk=critical_at_risk,
            population_affected=total_pop,
        )

    def _calculate_r0(
        self,
        propagation: PropagationResult,
        root_ids: list[str],
    ) -> float:
        """Calculate Infrastructure Failure R₀.

        R₀ = average number of newly failed/degraded/at-risk downstream
        assets directly caused by one failed asset.

        For single scenario:
          R₀ = count of direct downstream state changes / number of roots

        For more nuanced calculation across the cascade:
          R₀ = total direct downstream state changes / total assets that
               caused downstream changes
        """
        if not root_ids:
            return 0.0

        total_direct = 0
        for root_id in root_ids:
            direct = propagation.direct_failures_per_root.get(root_id, [])
            total_direct += len(direct)

        num_roots = len(root_ids)
        return total_direct / num_roots if num_roots > 0 else 0.0

    def _refine_with_capacity(
        self,
        propagation: PropagationResult,
        alternatives: dict[str, list],
        cap_engine: CapacityEngine,
    ) -> None:
        """Refine PROTECTED states using actual spare capacity.

        If an asset is marked PROTECTED but its live suppliers don't
        have enough spare capacity to cover the demand, downgrade the
        asset to AT_RISK (backup-dependent) or DEGRADED.
        """
        from app.models.schemas import AlternativeSupply, Asset, Dependency

        for node_id in list(propagation.asset_states.keys()):
            state = propagation.asset_states[node_id]
            if state != CascadeAssetState.PROTECTED:
                continue

            asset: Asset = self.graph.nodes[node_id]["asset"]

            # Check each dependency type: is there a live supplier
            # with sufficient spare capacity?
            dep_types_needing_supply: dict[str, float] = {}
            dep_types_available: dict[str, float] = {}

            for pred_id in self.graph.predecessors(node_id):
                edge_data = self.graph.edges[pred_id, node_id]
                dep: Dependency = edge_data["dependency"]
                dep_type = dep.dependency_type
                req = dep.required_capacity

                pred_state = propagation.asset_states.get(
                    pred_id, CascadeAssetState.OPERATIONAL
                )

                if dep_type not in dep_types_needing_supply:
                    dep_types_needing_supply[dep_type] = req
                    dep_types_available[dep_type] = 0.0

                if pred_state != CascadeAssetState.FAILED:
                    spare = cap_engine.get_spare_capacity(pred_id, propagation)
                    dep_types_available[dep_type] += min(spare, req)

            # Determine if all types are covered
            all_covered = True
            for dt, needed in dep_types_needing_supply.items():
                if needed > 0 and dep_types_available.get(dt, 0) < needed:
                    all_covered = False
                    break

            if not all_covered:
                # Check if asset has its own backup
                if asset.backup and asset.backup.fuel_minutes > 0:
                    propagation.asset_states[node_id] = CascadeAssetState.AT_RISK
                    # Capacity based on what's available
                    best_available = 0.0
                    for dt in dep_types_needing_supply:
                        needed = dep_types_needing_supply[dt]
                        if needed > 0:
                            best_available = max(
                                best_available,
                                dep_types_available.get(dt, 0) / needed * 100,
                            )
                    propagation.capacity_remaining[node_id] = min(best_available, 100.0)
                else:
                    propagation.asset_states[node_id] = CascadeAssetState.DEGRADED
                    propagation.capacity_remaining[node_id] = 50.0
