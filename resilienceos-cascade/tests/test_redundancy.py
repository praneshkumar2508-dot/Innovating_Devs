"""Tests for the RedundancyEngine — Phase 11."""

import pytest
from tests.conftest import make_asset, make_dep
from app.core.graph_builder import GraphBuilder
from app.core.propagation_engine import PropagationEngine
from app.core.redundancy_engine import RedundancyEngine
from app.models.enums import CascadeAssetState, FailureMode, DependencyLogic
from app.models.schemas import DependencyRequirement, FailureSpec


class TestRedundancy:
    """Phase 11 — redundant supplier analysis."""

    def test_redundant_power_protects_hospital(self):
        """Test 3: Hospital with two power sources → PROTECTED when one fails."""
        assets = [
            make_asset("POWER_A", capacity_value=100, load_value=75, criticality=0.9),
            make_asset("POWER_B", capacity_value=100, load_value=60, criticality=0.9),
            make_asset("HOSPITAL", "hospital", criticality=1.0,
                        capacity_value=500, load_value=420,
                        backup_type="generator", backup_capacity=30, backup_minutes=90,
                        requirements=[
                            DependencyRequirement(type="electricity", minimum_service=20, logic=DependencyLogic.OR),
                        ]),
        ]
        deps = [
            make_dep("D1", "POWER_A", "HOSPITAL", req_cap=20),
            make_dep("D2", "POWER_B", "HOSPITAL", req_cap=20),
        ]
        builder = GraphBuilder()
        builder.build(assets, deps)

        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="POWER_A", mode=FailureMode.COMPLETE)
        ])

        red = RedundancyEngine(builder.graph)
        alts = red.analyse(result)
        result = red.update_states_with_redundancy(result, alts)

        # Hospital should be protected because POWER_B has enough spare
        assert result.asset_states["HOSPITAL"] in (
            CascadeAssetState.PROTECTED,
            CascadeAssetState.OPERATIONAL,
        )

    def test_insufficient_alternative(self):
        """Test 4: Power B has insufficient spare capacity."""
        assets = [
            make_asset("POWER_A", capacity_value=100, load_value=75, criticality=0.9),
            make_asset("POWER_B", capacity_value=100, load_value=95, criticality=0.9),
            make_asset("HOSPITAL", "hospital", criticality=1.0,
                        capacity_value=500, load_value=420,
                        requirements=[
                            DependencyRequirement(type="electricity", minimum_service=20, logic=DependencyLogic.OR),
                        ]),
        ]
        deps = [
            make_dep("D1", "POWER_A", "HOSPITAL", req_cap=20),
            make_dep("D2", "POWER_B", "HOSPITAL", req_cap=20),
        ]
        builder = GraphBuilder()
        builder.build(assets, deps)

        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="POWER_A", mode=FailureMode.COMPLETE)
        ])

        red = RedundancyEngine(builder.graph)
        alts = red.analyse(result)

        # POWER_B spare = 100 - 95 = 5, needs 20 → not feasible
        hosp_alts = alts.get("HOSPITAL", [])
        power_b_alt = [a for a in hosp_alts if a.source_asset_id == "POWER_B"]
        if power_b_alt:
            assert power_b_alt[0].feasible is False

    def test_alternative_supply_data(self):
        """Alternatives include correct capacity data."""
        assets = [
            make_asset("POWER_A", capacity_value=100, load_value=75, criticality=0.9),
            make_asset("POWER_B", capacity_value=100, load_value=60, criticality=0.9),
            make_asset("LOAD", criticality=0.5,
                        requirements=[
                            DependencyRequirement(type="electricity", minimum_service=20, logic=DependencyLogic.OR),
                        ]),
        ]
        deps = [
            make_dep("D1", "POWER_A", "LOAD", req_cap=20),
            make_dep("D2", "POWER_B", "LOAD", req_cap=20),
        ]
        builder = GraphBuilder()
        builder.build(assets, deps)

        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="POWER_A", mode=FailureMode.COMPLETE)
        ])

        red = RedundancyEngine(builder.graph)
        alts = red.analyse(result)

        load_alts = alts.get("LOAD", [])
        b_alt = [a for a in load_alts if a.source_asset_id == "POWER_B"]
        assert len(b_alt) == 1
        assert b_alt[0].available_capacity == pytest.approx(40.0)  # 100-60
        assert b_alt[0].required_capacity == 20
        assert b_alt[0].feasible is True
