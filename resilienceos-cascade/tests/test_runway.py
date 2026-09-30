"""Tests for the RunwayEngine — Phase 15, 16."""

import pytest
from tests.conftest import build_basic_graph, make_asset, make_dep
from app.core.graph_builder import GraphBuilder
from app.core.propagation_engine import PropagationEngine
from app.core.runway_engine import RunwayEngine
from app.models.enums import CascadeAssetState, FailureMode
from app.models.schemas import FailureSpec


class TestRunway:
    """Phase 15 — backup runway calculation."""

    def test_hospital_backup_runway(self):
        """Test 2: Hospital with 90-minute generator → runway = 90."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        run = RunwayEngine(builder.graph)
        runways, events = run.analyse(result)

        hosp_runway = runways.get("HOSPITAL_01")
        assert hosp_runway is not None
        assert hosp_runway.has_backup is True
        assert hosp_runway.runway_minutes == pytest.approx(90.0)

    def test_telecom_battery_runway(self):
        """Telecom with 120-minute battery."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        run = RunwayEngine(builder.graph)
        runways, _ = run.analyse(result)

        tc = runways.get("TELECOM_01")
        assert tc is not None
        assert tc.has_backup is True
        assert tc.runway_minutes == pytest.approx(120.0)

    def test_water_plant_storage_runway(self):
        """Water plant with 35-minute storage."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        run = RunwayEngine(builder.graph)
        runways, _ = run.analyse(result)

        wp = runways.get("WATER_PLANT_01")
        assert wp is not None
        assert wp.has_backup is True
        assert wp.runway_minutes == pytest.approx(35.0)


class TestTimeline:
    """Phase 16 — time-based cascade events."""

    def test_timeline_events_generated(self):
        """Timeline includes backup activation and exhaustion."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        run = RunwayEngine(builder.graph)
        runways, _ = run.analyse(result)
        timeline = run.compute_time_cascade(result, runways)

        # Should have root failure event
        root_events = [e for e in timeline if "SUBSTATION_A" in e.event and e.time_minutes == 0]
        assert len(root_events) > 0

        # Should have backup exhaustion events
        exhaust_events = [e for e in timeline if "EXHAUSTED" in e.event]
        assert len(exhaust_events) > 0

    def test_timeline_chronological(self):
        """Events are in chronological order."""
        builder, _, _ = build_basic_graph()
        prop = PropagationEngine(builder.graph)
        result = prop.propagate([
            FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)
        ])

        run = RunwayEngine(builder.graph)
        runways, _ = run.analyse(result)
        timeline = run.compute_time_cascade(result, runways)

        times = [e.time_minutes for e in timeline]
        assert times == sorted(times)
