"""Tests for the PropagationEngine — Phases 9, 12, 17, 18."""

import pytest
from tests.conftest import build_basic_graph, make_asset, make_dep
from app.core.graph_builder import GraphBuilder
from app.core.propagation_engine import PropagationEngine
from app.models.enums import CascadeAssetState, FailureMode, DependencyLogic
from app.models.schemas import FailureSpec, DependencyRequirement


class TestDirectImpact:
    """Phase 9 — direct impact analysis."""

    def test_complete_failure_affects_dependents(self):
        """Test 1: SUBSTATION_A fails → hospital, water, telecom affected."""
        builder, _, _ = build_basic_graph()
        engine = PropagationEngine(builder.graph)
        result = engine.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        assert result.asset_states["SUBSTATION_A"] == CascadeAssetState.FAILED

        # Direct dependents should not be OPERATIONAL
        for aid in ["HOSPITAL_01", "WATER_PLANT_01", "TELECOM_01"]:
            assert result.asset_states[aid] != CascadeAssetState.OPERATIONAL, \
                f"{aid} should be affected"

    def test_cascade_depth(self):
        """Phase 17: cascade depth is correctly calculated."""
        builder, _, _ = build_basic_graph()
        engine = PropagationEngine(builder.graph)
        result = engine.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        assert result.cascade_depth["SUBSTATION_A"] == 0
        assert result.cascade_depth["HOSPITAL_01"] == 1
        # Emergency depends on Hospital (depth 1) → depth 2
        assert result.cascade_depth.get("EMERGENCY_01", 99) <= 2

    def test_cascade_paths(self):
        """Phase 18: exact cascade paths are returned."""
        builder, _, _ = build_basic_graph()
        engine = PropagationEngine(builder.graph)
        result = engine.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        # Hospital should have path from substation
        hosp_paths = result.cascade_paths.get("HOSPITAL_01", [])
        assert len(hosp_paths) > 0
        assert hosp_paths[0] == ["SUBSTATION_A", "HOSPITAL_01"]

    def test_emergency_has_multi_paths(self):
        """Emergency services reachable via multiple paths."""
        builder, _, _ = build_basic_graph()
        engine = PropagationEngine(builder.graph)
        result = engine.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        em_paths = result.cascade_paths.get("EMERGENCY_01", [])
        # Should have path through hospital AND through telecom
        assert len(em_paths) >= 2


class TestPartialFailure:
    """Phase 8 — partial failure scenarios."""

    def test_capacity_reduction(self):
        """Test 5: partial failure reduces capacity."""
        builder, _, _ = build_basic_graph()
        engine = PropagationEngine(builder.graph)
        result = engine.propagate([
            FailureSpec(
                asset_id="SUBSTATION_A",
                mode=FailureMode.CAPACITY_REDUCTION,
                remaining_capacity_percent=40,
            )
        ])

        assert result.asset_states["SUBSTATION_A"] == CascadeAssetState.DEGRADED
        assert result.capacity_remaining["SUBSTATION_A"] == 40.0


class TestMultipleFailures:
    """Phase 8 — multiple simultaneous failures."""

    def test_two_simultaneous_failures(self):
        """Test 6: Power A and Telecom fail together."""
        builder, _, _ = build_basic_graph()
        engine = PropagationEngine(builder.graph)
        result = engine.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE),
            FailureSpec(asset_id="TELECOM_01", mode=FailureMode.COMPLETE),
        ])

        assert result.asset_states["SUBSTATION_A"] == CascadeAssetState.FAILED
        assert result.asset_states["TELECOM_01"] == CascadeAssetState.FAILED

        # Emergency should be affected by both
        em_state = result.asset_states.get("EMERGENCY_01")
        assert em_state != CascadeAssetState.OPERATIONAL


class TestIsolatedAsset:
    """Test 7 — failing an isolated asset."""

    def test_isolated_no_cascade(self):
        assets = [make_asset("ISOLATED", criticality=0.5)]
        deps = []
        builder = GraphBuilder()
        builder.build(assets, deps)

        engine = PropagationEngine(builder.graph)
        result = engine.propagate([
            FailureSpec(asset_id="ISOLATED", mode=FailureMode.COMPLETE)
        ])

        assert result.asset_states["ISOLATED"] == CascadeAssetState.FAILED
        assert result.cascade_depth["ISOLATED"] == 0
        # No other assets affected
        non_root = [
            k for k, v in result.asset_states.items()
            if k != "ISOLATED" and v != CascadeAssetState.OPERATIONAL
        ]
        assert len(non_root) == 0


class TestCircularDependency:
    """Test 8 — circular dependency does not crash."""

    def test_cycle_terminates(self):
        assets = [make_asset("A"), make_asset("B"), make_asset("C")]
        deps = [
            make_dep("D1", "A", "B"),
            make_dep("D2", "B", "C"),
            make_dep("D3", "C", "A"),
        ]
        builder = GraphBuilder()
        builder.build(assets, deps)

        engine = PropagationEngine(builder.graph)
        # Must not hang or crash
        result = engine.propagate([
            FailureSpec(asset_id="A", mode=FailureMode.COMPLETE)
        ])

        assert result.asset_states["A"] == CascadeAssetState.FAILED
