"""Tests for the CapacityEngine — Phase 10."""

import pytest
from tests.conftest import build_basic_graph, make_asset, make_dep
from app.core.graph_builder import GraphBuilder
from app.core.propagation_engine import PropagationEngine
from app.core.capacity_engine import CapacityEngine
from app.models.enums import CascadeAssetState, FailureMode
from app.models.schemas import FailureSpec


class TestCapacityAnalysis:
    """Phase 10 — capacity shortfall and surplus detection."""

    def test_capacity_shortfall_on_failure(self):
        """When power fails, dependents have capacity shortfall."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        cap_engine = CapacityEngine(builder.graph)
        details = cap_engine.analyse(result)

        # Hospital requires 20 MW from substation — now 0
        hosp = details["HOSPITAL_01"]
        assert hosp.total_required > 0
        assert hosp.shortfall > 0

    def test_spare_capacity_calculation(self):
        """Spare capacity = total - current load."""
        assets = [
            make_asset("PWR", capacity_value=100, load_value=60),
            make_asset("LOAD", criticality=0.5),
        ]
        deps = [make_dep("D1", "PWR", "LOAD", req_cap=20)]
        builder = GraphBuilder()
        builder.build(assets, deps)

        prop = PropagationEngine(builder.graph)
        result = prop.propagate([])  # no failures

        cap_engine = CapacityEngine(builder.graph)
        spare = cap_engine.get_spare_capacity("PWR", result)
        assert spare == pytest.approx(40.0)  # 100 - 60

    def test_no_spare_on_failed(self):
        """Failed supplier has zero spare capacity."""
        assets = [
            make_asset("PWR", capacity_value=100, load_value=60),
            make_asset("LOAD", criticality=0.5),
        ]
        deps = [make_dep("D1", "PWR", "LOAD", req_cap=20)]
        builder = GraphBuilder()
        builder.build(assets, deps)

        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="PWR", mode=FailureMode.COMPLETE)
        ])

        cap_engine = CapacityEngine(builder.graph)
        spare = cap_engine.get_spare_capacity("PWR", result)
        assert spare == 0.0
