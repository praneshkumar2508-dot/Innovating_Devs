"""Tests for the CascadeEngine — Phases 20, 21, 22, 23, 24, 33."""

import pytest
from tests.conftest import build_basic_graph, make_asset, make_dep
from app.core.graph_builder import GraphBuilder
from app.core.cascade_engine import CascadeEngine
from app.models.enums import CascadeAssetState, FailureMode, DependencyLogic
from app.models.schemas import DependencyRequirement, FailureSpec, ScenarioInput


class TestEndToEnd:
    """Phase 33 — end-to-end real test scenario."""

    def _build_e2e_graph(self, power_b_load: float = 60):
        """Build the Phase 33 test graph."""
        assets = [
            make_asset("POWER_A", "power_station", criticality=0.95,
                        capacity_value=100, load_value=75, population=120000),
            make_asset("POWER_B", "power_station", criticality=0.90,
                        capacity_value=100, load_value=power_b_load, population=80000),
            make_asset("HOSPITAL", "hospital", criticality=1.0,
                        capacity_value=500, load_value=420,
                        population=50000,
                        backup_type="generator", backup_capacity=30, backup_minutes=90,
                        requirements=[
                            DependencyRequirement(type="electricity", minimum_service=20, logic=DependencyLogic.OR),
                        ]),
            make_asset("WATER_PLANT", "water_plant", criticality=0.95,
                        capacity_value=200, load_value=150,
                        population=50000,
                        backup_type="storage", backup_capacity=1000, backup_minutes=35),
            make_asset("TELECOM", "telecom_tower", criticality=0.85,
                        capacity_value=10000, load_value=8500,
                        population=75000,
                        backup_type="battery", backup_capacity=5, backup_minutes=120),
        ]
        deps = [
            make_dep("D1", "POWER_A", "HOSPITAL", req_cap=20),
            make_dep("D2", "POWER_A", "WATER_PLANT", req_cap=30),
            make_dep("D3", "POWER_A", "TELECOM", req_cap=10),
            make_dep("D4", "POWER_B", "HOSPITAL", req_cap=20),
        ]
        from app.core.graph_builder import GraphBuilder
        builder = GraphBuilder()
        builder.build(assets, deps)
        return builder

    def test_complete_failure_analysis(self):
        """Phase 33: POWER_A fails → full analysis."""
        builder = self._build_e2e_graph()
        engine = CascadeEngine(builder.graph)
        scenario = ScenarioInput(
            scenario_id="E2E_TEST",
            root_failures=[
                FailureSpec(asset_id="POWER_A", mode=FailureMode.COMPLETE)
            ],
        )
        result = engine.run(scenario)

        # 1. Root failure recorded
        assert "POWER_A" in result.root_failures

        # 2. Affected assets include hospital, water, telecom
        affected_ids = {a.asset_id for a in result.affected_assets}
        assert "HOSPITAL" in affected_ids
        assert "WATER_PLANT" in affected_ids
        assert "TELECOM" in affected_ids

        # 3. Hospital should be protected (POWER_B available with spare = 40MW > 20MW)
        hospital = next(a for a in result.affected_assets if a.asset_id == "HOSPITAL")
        assert hospital.state in (CascadeAssetState.PROTECTED, CascadeAssetState.AT_RISK)

        # 4. Water plant has backup
        water = next(a for a in result.affected_assets if a.asset_id == "WATER_PLANT")
        assert water.runway_minutes is not None
        assert water.runway_minutes == pytest.approx(35.0)

        # 5. Telecom has battery backup
        telecom = next(a for a in result.affected_assets if a.asset_id == "TELECOM")
        assert telecom.runway_minutes is not None
        assert telecom.runway_minutes == pytest.approx(120.0)

        # 6. Cascade depth > 0
        assert result.summary.cascade_depth >= 1

        # 7. R₀ > 0
        assert result.summary.failure_r0 > 0

        # 8. Paths exist
        assert len(hospital.paths) > 0

        # 9. Timeline exists
        assert len(result.timeline) > 0

        # 10. Impact scores are in [0, 1]
        for a in result.affected_assets:
            assert 0 <= a.impact_score <= 1

    def test_changing_input_changes_output(self):
        """Phase 33 MANDATORY: Changing POWER_B load changes result.

        With load=60: spare=40 → hospital protected.
        With load=90: spare=10 → hospital NOT fully protected.
        """
        # Run with POWER_B load = 60 (spare = 40, feasible)
        builder_60 = self._build_e2e_graph(power_b_load=60)
        engine_60 = CascadeEngine(builder_60.graph)
        result_60 = engine_60.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="POWER_A", mode=FailureMode.COMPLETE)]
        ))

        # Run with POWER_B load = 90 (spare = 10, insufficient for 20)
        builder_90 = self._build_e2e_graph(power_b_load=90)
        engine_90 = CascadeEngine(builder_90.graph)
        result_90 = engine_90.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="POWER_A", mode=FailureMode.COMPLETE)]
        ))

        # Hospital states should differ
        hosp_60 = next(a for a in result_60.affected_assets if a.asset_id == "HOSPITAL")
        hosp_90 = next(a for a in result_90.affected_assets if a.asset_id == "HOSPITAL")

        # With sufficient spare, hospital is better off
        assert hosp_60.state != hosp_90.state or hosp_60.impact_score != hosp_90.impact_score, \
            "Changing POWER_B load must change the analysis result"


class TestImpactScore:
    """Phase 20 — impact score documentation and correctness."""

    def test_impact_score_normalized(self):
        """All impact scores are in [0, 1]."""
        builder, _, _ = build_basic_graph()
        engine = CascadeEngine(builder.graph)
        result = engine.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)]
        ))
        for a in result.affected_assets:
            assert 0 <= a.impact_score <= 1

    def test_failed_critical_has_high_impact(self):
        """A failed asset with high criticality should have a high impact score."""
        builder, _, _ = build_basic_graph()
        engine = CascadeEngine(builder.graph)
        result = engine.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)]
        ))
        sub = next(a for a in result.affected_assets if a.asset_id == "SUBSTATION_A")
        assert sub.impact_score >= 0.5


class TestFailureR0:
    """Phase 21 — Infrastructure Failure R₀."""

    def test_r0_calculated(self):
        """R₀ is computed and > 0 when cascade occurs."""
        builder, _, _ = build_basic_graph()
        engine = CascadeEngine(builder.graph)
        result = engine.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)]
        ))
        assert result.summary.failure_r0 > 0

    def test_r0_for_isolated(self):
        """Isolated failure → R₀ = 0."""
        assets = [make_asset("ALONE", criticality=0.5)]
        builder = GraphBuilder()
        builder.build(assets, [])
        engine = CascadeEngine(builder.graph)
        result = engine.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="ALONE", mode=FailureMode.COMPLETE)]
        ))
        assert result.summary.failure_r0 == 0.0


class TestStateDistinction:
    """Phase 22 — at-risk vs. failed states."""

    def test_backup_asset_not_failed(self):
        """Asset with backup should not be immediately FAILED."""
        builder, _, _ = build_basic_graph()
        engine = CascadeEngine(builder.graph)
        result = engine.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)]
        ))

        hospital = next(a for a in result.affected_assets if a.asset_id == "HOSPITAL_01")
        # Hospital has backup → should NOT be FAILED
        assert hospital.state != CascadeAssetState.FAILED


class TestPopulationImpact:
    """Phase 23 — population impact."""

    def test_population_counted(self):
        """Population affected is calculated when data exists."""
        builder, _, _ = build_basic_graph()
        engine = CascadeEngine(builder.graph)
        result = engine.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)]
        ))
        assert result.summary.population_affected is not None
        assert result.summary.population_affected > 0


class TestPropertyInvariants:
    """Phase 28 — fundamental invariants."""

    def test_runway_non_negative(self):
        """Invariant 2: runway is never negative."""
        builder, _, _ = build_basic_graph()
        engine = CascadeEngine(builder.graph)
        result = engine.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)]
        ))
        for a in result.affected_assets:
            if a.runway_minutes is not None:
                assert a.runway_minutes >= 0

    def test_criticality_in_range(self):
        """Invariant 3: criticality in [0, 1]."""
        builder, _, _ = build_basic_graph()
        engine = CascadeEngine(builder.graph)
        result = engine.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)]
        ))
        for a in result.affected_assets:
            assert 0 <= a.criticality <= 1

    def test_cascade_depth_non_negative(self):
        """Invariant 4: cascade depth never negative."""
        builder, _, _ = build_basic_graph()
        engine = CascadeEngine(builder.graph)
        result = engine.run(ScenarioInput(
            root_failures=[FailureSpec(asset_id="SUBSTATION_A", mode=FailureMode.COMPLETE)]
        ))
        assert result.summary.cascade_depth >= 0
        for a in result.affected_assets:
            assert a.cascade_depth >= 0
