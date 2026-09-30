"""Tests for the CriticalityEngine — Phase 19, 20."""

import pytest
from tests.conftest import build_basic_graph, make_asset, make_dep
from app.core.graph_builder import GraphBuilder
from app.core.propagation_engine import PropagationEngine
from app.core.criticality_engine import CriticalityEngine
from app.models.enums import CascadeAssetState, FailureMode
from app.models.schemas import FailureSpec


class TestCriticality:
    """Phase 19 — criticality from input data."""

    def test_criticality_from_data(self):
        """Criticality values come from asset data, not hard-coded."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        crit = CriticalityEngine(builder.graph)
        details = crit.analyse(result)

        assert details["HOSPITAL_01"].criticality == 1.0
        assert details["WATER_PLANT_01"].criticality == 0.95
        assert details["TELECOM_01"].criticality == 0.85

    def test_critical_service_identification(self):
        """Assets with criticality >= 0.8 are flagged as critical services."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([])

        crit = CriticalityEngine(builder.graph)
        details = crit.analyse(result)

        assert details["HOSPITAL_01"].is_critical_service is True
        assert details["EMERGENCY_01"].is_critical_service is True
        assert details["TELECOM_01"].is_critical_service is True

    def test_criticality_weighted_loss(self):
        """Failed asset has criticality-weighted loss = criticality."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        crit = CriticalityEngine(builder.graph)
        details = crit.analyse(result)

        sub = details["SUBSTATION_A"]
        assert sub.criticality_weighted_loss == pytest.approx(0.85)  # criticality * 1.0

    def test_count_critical_at_risk(self):
        """Count of critical services at risk or worse."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        crit = CriticalityEngine(builder.graph)
        details = crit.analyse(result)
        count = crit.count_critical_at_risk(details)
        assert count >= 1
