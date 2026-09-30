"""Redundancy engine — identifies alternative supply paths and determines
whether downstream assets can be sustained through redundant suppliers.

The engine does NOT automatically transfer load.  It identifies
feasibility so the Recovery Optimiser can decide.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import networkx as nx

from app.models.enums import CascadeAssetState
from app.models.schemas import AlternativeSupply, Asset, Dependency
from app.core.propagation_engine import PropagationResult
from app.core.capacity_engine import CapacityEngine


class RedundancyEngine:
    """Analyses redundant / alternative supply for affected assets."""

    def __init__(self, graph: nx.DiGraph) -> None:
        self.graph = graph
        self._capacity_engine = CapacityEngine(graph)

    def analyse(
        self,
        propagation: PropagationResult,
    ) -> dict[str, list[AlternativeSupply]]:
        """For every affected asset, find alternative suppliers.

        Parameters
        ----------
        propagation : PropagationResult
            Output of the propagation engine.

        Returns
        -------
        dict[str, list[AlternativeSupply]]
            Mapping asset_id → list of alternative supply options.
        """
        alternatives: dict[str, list[AlternativeSupply]] = defaultdict(list)

        for node_id in self.graph.nodes:
            state = propagation.asset_states.get(node_id, CascadeAssetState.OPERATIONAL)

            # Check if this asset has any failed/degraded predecessors
            has_impaired_supplier = False
            for pred_id in self.graph.predecessors(node_id):
                pred_state = propagation.asset_states.get(pred_id, CascadeAssetState.OPERATIONAL)
                if pred_state in (CascadeAssetState.FAILED, CascadeAssetState.DEGRADED, CascadeAssetState.AT_RISK):
                    has_impaired_supplier = True
                    break

            # Skip only if fully operational AND no suppliers are impaired
            if state in (CascadeAssetState.OPERATIONAL, CascadeAssetState.PROTECTED) and not has_impaired_supplier:
                continue

            asset: Asset = self.graph.nodes[node_id]["asset"]

            # Group suppliers by dependency type
            suppliers_by_type: dict[str, list[tuple[str, Dependency]]] = defaultdict(list)
            for pred_id in self.graph.predecessors(node_id):
                edge_data = self.graph.edges[pred_id, node_id]
                dep: Dependency = edge_data["dependency"]
                suppliers_by_type[dep.dependency_type].append((pred_id, dep))

            for dep_type, suppliers in suppliers_by_type.items():
                for pred_id, dep in suppliers:
                    pred_state = propagation.asset_states.get(
                        pred_id, CascadeAssetState.OPERATIONAL
                    )

                    # Only consider suppliers that are not failed
                    if pred_state == CascadeAssetState.FAILED:
                        continue

                    spare = self._capacity_engine.get_spare_capacity(
                        pred_id, propagation
                    )
                    required = dep.required_capacity

                    alt = AlternativeSupply(
                        source_asset_id=pred_id,
                        dependency_type=dep_type,
                        available_capacity=spare,
                        required_capacity=required,
                        feasible=spare >= required if required > 0 else True,
                        capacity_unit=dep.capacity_unit,
                    )
                    alternatives[node_id].append(alt)

        return dict(alternatives)

    def update_states_with_redundancy(
        self,
        propagation: PropagationResult,
        alternatives: dict[str, list[AlternativeSupply]],
    ) -> PropagationResult:
        """Update asset states where redundant supply is feasible.

        If ALL required dependency types can be satisfied by at least one
        alternative, the asset is marked PROTECTED instead of FAILED.

        Parameters
        ----------
        propagation : PropagationResult
            Propagation result to update (mutated in place).
        alternatives : dict[str, list[AlternativeSupply]]
            Output of analyse().

        Returns
        -------
        PropagationResult
        """
        for node_id, alt_list in alternatives.items():
            current_state = propagation.asset_states.get(
                node_id, CascadeAssetState.OPERATIONAL
            )

            if current_state == CascadeAssetState.OPERATIONAL:
                continue

            asset: Asset = self.graph.nodes[node_id]["asset"]

            # Group alternatives by dependency type
            type_feasibility: dict[str, bool] = {}
            for alt in alt_list:
                dt = alt.dependency_type
                if dt not in type_feasibility:
                    type_feasibility[dt] = False
                if alt.feasible:
                    type_feasibility[dt] = True

            # Check: are ALL dependency types covered by at least one feasible alt?
            # Also consider types where the supplier is still operational
            all_types_covered = True
            any_type_covered = False

            # Get all dependency types incoming to this asset
            required_types: set[str] = set()
            for pred_id in self.graph.predecessors(node_id):
                edge_data = self.graph.edges[pred_id, node_id]
                dep: Dependency = edge_data["dependency"]
                if dep.critical:
                    required_types.add(dep.dependency_type)

            for req_type in required_types:
                # Is this type still being supplied by a non-failed source?
                has_live_supply = False
                for pred_id in self.graph.predecessors(node_id):
                    edge_data = self.graph.edges[pred_id, node_id]
                    dep: Dependency = edge_data["dependency"]
                    if dep.dependency_type != req_type:
                        continue
                    pred_state = propagation.asset_states.get(
                        pred_id, CascadeAssetState.OPERATIONAL
                    )
                    if pred_state not in (CascadeAssetState.FAILED,):
                        has_live_supply = True
                        break

                feasible_alt = type_feasibility.get(req_type, False)

                if has_live_supply or feasible_alt:
                    any_type_covered = True
                else:
                    all_types_covered = False

            if all_types_covered and required_types:
                # Asset has backup on the asset itself?
                has_backup = asset.backup is not None

                if has_backup and current_state in (
                    CascadeAssetState.FAILED,
                    CascadeAssetState.AT_RISK,
                    CascadeAssetState.DEGRADED,
                ):
                    propagation.asset_states[node_id] = CascadeAssetState.PROTECTED
                    propagation.capacity_remaining[node_id] = 100.0
                elif any_type_covered:
                    propagation.asset_states[node_id] = CascadeAssetState.PROTECTED
                    propagation.capacity_remaining[node_id] = 100.0

        return propagation
