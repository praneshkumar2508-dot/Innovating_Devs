"""Propagation engine — BFS-based cascade propagation through the
dependency graph.

Determines which assets are directly/indirectly affected, calculates
cascade depth, and records the exact dependency paths that carry the
impact.
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Optional

import networkx as nx

from app.config import settings
from app.models.enums import AssetStatus, CascadeAssetState, FailureMode
from app.models.schemas import Asset, Dependency, FailureSpec


class PropagationResult:
    """Intermediate result produced by the propagation engine."""

    def __init__(self) -> None:
        # asset_id → CascadeAssetState
        self.asset_states: dict[str, CascadeAssetState] = {}
        # asset_id → cascade depth (shortest path from any root)
        self.cascade_depth: dict[str, int] = {}
        # asset_id → list of paths (each path is a list of asset_ids)
        self.cascade_paths: dict[str, list[list[str]]] = defaultdict(list)
        # asset_id → remaining capacity percent after failure applied
        self.capacity_remaining: dict[str, float] = {}
        # ordered list of (asset_id, depth) showing propagation order
        self.propagation_order: list[tuple[str, int]] = []
        # Newly failed direct downstream assets per root (for R₀)
        self.direct_failures_per_root: dict[str, list[str]] = defaultdict(list)


class PropagationEngine:
    """BFS-based cascade propagation engine.

    Given a graph and a set of root failures, propagates the cascade and
    determines the state of every downstream asset.

    This engine does NOT make recovery decisions — it identifies
    feasibility and leaves decisions to the Recovery Optimiser.
    """

    def __init__(self, graph: nx.DiGraph) -> None:
        self.graph = graph

    def propagate(
        self,
        root_failures: list[FailureSpec],
    ) -> PropagationResult:
        """Run BFS cascade propagation.

        Parameters
        ----------
        root_failures : list[FailureSpec]
            The initial failure specifications.

        Returns
        -------
        PropagationResult
        """
        result = PropagationResult()

        # Initialise every node as OPERATIONAL with full capacity
        for node in self.graph.nodes:
            node_data = self.graph.nodes[node]
            status = node_data.get("status", AssetStatus.OPERATIONAL)
            if status == AssetStatus.FAILED:
                result.asset_states[node] = CascadeAssetState.FAILED
                result.capacity_remaining[node] = 0.0
            elif status == AssetStatus.DEGRADED:
                result.asset_states[node] = CascadeAssetState.DEGRADED
                cap = node_data.get("capacity_available_percent", 100.0)
                result.capacity_remaining[node] = cap
            else:
                result.asset_states[node] = CascadeAssetState.OPERATIONAL
                cap = node_data.get("capacity_available_percent", 100.0)
                result.capacity_remaining[node] = cap

        # Apply root failures
        queue: deque[tuple[str, int]] = deque()  # (asset_id, depth)
        visited_in_queue: set[str] = set()

        for failure in root_failures:
            aid = failure.asset_id
            if aid not in self.graph:
                continue  # caller should validate beforehand

            depth = 0
            result.cascade_depth[aid] = depth
            result.cascade_paths[aid] = [[aid]]
            result.propagation_order.append((aid, depth))

            if failure.mode == FailureMode.COMPLETE:
                result.asset_states[aid] = CascadeAssetState.FAILED
                result.capacity_remaining[aid] = 0.0
            elif failure.mode in (FailureMode.CAPACITY_REDUCTION, FailureMode.DEGRADED):
                result.asset_states[aid] = CascadeAssetState.DEGRADED
                result.capacity_remaining[aid] = failure.remaining_capacity_percent
            else:
                result.asset_states[aid] = CascadeAssetState.FAILED
                result.capacity_remaining[aid] = 0.0

            queue.append((aid, depth))
            visited_in_queue.add(aid)

        # BFS propagation
        iteration = 0
        while queue and iteration < settings.max_cascade_iterations:
            iteration += 1
            source_id, source_depth = queue.popleft()
            child_depth = source_depth + 1

            # Find all assets that depend on this source
            successors = list(self.graph.successors(source_id))

            for target_id in successors:
                # Skip if target is already a root failure
                is_root = any(f.asset_id == target_id for f in root_failures)

                # Calculate new state for target based on ALL its suppliers
                new_state, new_cap = self._evaluate_asset_state(
                    target_id, result
                )

                old_state = result.asset_states.get(
                    target_id, CascadeAssetState.OPERATIONAL
                )

                # Record paths from source to target
                for src_path in result.cascade_paths.get(source_id, [[source_id]]):
                    new_path = src_path + [target_id]
                    if new_path not in result.cascade_paths[target_id]:
                        result.cascade_paths[target_id].append(new_path)

                # Update depth (shortest)
                if target_id not in result.cascade_depth:
                    result.cascade_depth[target_id] = child_depth
                else:
                    result.cascade_depth[target_id] = min(
                        result.cascade_depth[target_id], child_depth
                    )

                state_changed = (new_state != old_state) and not is_root

                if new_state != CascadeAssetState.OPERATIONAL or state_changed:
                    result.asset_states[target_id] = new_state
                    result.capacity_remaining[target_id] = new_cap
                    result.propagation_order.append((target_id, child_depth))

                    # Track direct failures per root for R₀
                    if child_depth == 1 and new_state in (
                        CascadeAssetState.FAILED,
                        CascadeAssetState.DEGRADED,
                        CascadeAssetState.AT_RISK,
                    ):
                        result.direct_failures_per_root[source_id].append(target_id)

                    # Re-queue if state worsened and not already queued
                    if state_changed and target_id not in visited_in_queue:
                        queue.append((target_id, child_depth))
                        visited_in_queue.add(target_id)

        return result

    def _evaluate_asset_state(
        self,
        asset_id: str,
        result: PropagationResult,
    ) -> tuple[CascadeAssetState, float]:
        """Evaluate the state of an asset based on ALL incoming dependencies.

        Returns (new_state, capacity_available_percent).
        """
        asset: Asset = self.graph.nodes[asset_id]["asset"]

        # Group incoming edges by dependency type
        type_supplies: dict[str, list[tuple[str, Dependency, float]]] = defaultdict(list)

        for pred in self.graph.predecessors(asset_id):
            edge_data = self.graph.edges[pred, asset_id]
            dep: Dependency = edge_data["dependency"]
            dep_type = dep.dependency_type

            # Supplier's available capacity
            supplier_cap_pct = result.capacity_remaining.get(pred, 100.0)
            supplier_state = result.asset_states.get(pred, CascadeAssetState.OPERATIONAL)

            if supplier_state == CascadeAssetState.FAILED:
                supply_fraction = 0.0
            else:
                supply_fraction = supplier_cap_pct / 100.0

            type_supplies[dep_type].append((pred, dep, supply_fraction))

        if not type_supplies:
            # No dependencies → asset is self-sufficient
            return CascadeAssetState.OPERATIONAL, result.capacity_remaining.get(asset_id, 100.0)

        # Evaluate each dependency type requirement
        requirements = {r.type: r for r in asset.requirements}
        satisfaction: dict[str, float] = {}

        any_critical_failed = False
        any_degraded = False
        all_satisfied = True
        any_supplier_failed = False

        for dep_type, supplies in type_supplies.items():
            req = requirements.get(dep_type)

            # Determine total available supply for this type
            total_available = 0.0
            total_required = 0.0
            any_source_ok = False
            all_sources_ok = True

            for pred_id, dep, supply_frac in supplies:
                # Track if any supplier in this type has failed
                if supply_frac < 0.01:
                    any_supplier_failed = True

                # How much does this edge provide?
                if dep.required_capacity > 0:
                    provided = dep.required_capacity * supply_frac
                    total_available += provided
                    total_required = max(total_required, dep.required_capacity)
                else:
                    # No specific capacity requirement — binary evaluation
                    if supply_frac > dep.failure_threshold:
                        any_source_ok = True
                        total_available += 1.0
                    else:
                        all_sources_ok = False
                        any_supplier_failed = True
                    total_required = max(total_required, 1.0)

            # Determine satisfaction ratio
            if total_required > 0:
                sat = min(total_available / total_required, 1.0)
            else:
                sat = 1.0 if any_source_ok else 0.0

            satisfaction[dep_type] = sat

            # Determine dependency logic
            logic = "OR"  # default
            if req:
                logic = req.logic.value
                min_svc = req.minimum_service
                # If minimum service specified, check absolute supply
                if min_svc > 0 and total_available < min_svc:
                    sat = total_available / min_svc
                    satisfaction[dep_type] = sat

            is_critical = any(dep.critical for _, dep, _ in supplies)

            if sat < 0.01:
                if is_critical:
                    any_critical_failed = True
                all_satisfied = False
            elif sat < 1.0:
                any_degraded = True
                all_satisfied = False

        # Determine overall asset state
        if any_critical_failed:
            return CascadeAssetState.FAILED, 0.0
        elif any_degraded:
            # Average satisfaction across types
            avg_sat = sum(satisfaction.values()) / len(satisfaction) if satisfaction else 1.0
            cap_pct = avg_sat * 100.0
            if avg_sat < 0.5:
                return CascadeAssetState.AT_RISK, cap_pct
            return CascadeAssetState.DEGRADED, cap_pct
        elif all_satisfied and any_supplier_failed:
            # All needs met but through redundancy — asset is protected
            return CascadeAssetState.PROTECTED, 100.0
        elif all_satisfied:
            return CascadeAssetState.OPERATIONAL, 100.0
        else:
            return CascadeAssetState.AT_RISK, 50.0

