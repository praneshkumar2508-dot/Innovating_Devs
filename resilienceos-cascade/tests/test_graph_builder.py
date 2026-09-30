"""Tests for the GraphBuilder — Phases 5, 6."""

import pytest
from tests.conftest import make_asset, make_dep, build_basic_graph
from app.core.graph_builder import GraphBuilder
from app.models.enums import ValidationErrorCode


class TestGraphConstruction:
    """Phase 5 — graph is built dynamically from data."""

    def test_nodes_created(self):
        builder, assets, _ = build_basic_graph()
        assert builder.graph.number_of_nodes() == len(assets)

    def test_edges_created(self):
        builder, _, deps = build_basic_graph()
        assert builder.graph.number_of_edges() == len(deps)

    def test_edge_metadata_stored(self):
        builder, _, _ = build_basic_graph()
        edge = builder.graph.edges["SUBSTATION_A", "HOSPITAL_01"]
        assert edge["dependency_type"] == "electricity"
        assert edge["required_capacity"] == 20
        assert edge["critical"] is True

    def test_asset_retrievable(self):
        builder, _, _ = build_basic_graph()
        asset = builder.get_asset("HOSPITAL_01")
        assert asset is not None
        assert asset.criticality == 1.0


class TestGraphValidation:
    """Phase 6 — all 9 validation checks."""

    def test_missing_source(self):
        """Check 1 — dependency references non-existent source."""
        assets = [make_asset("A")]
        deps = [make_dep("D1", "MISSING", "A")]
        builder = GraphBuilder()
        result = builder.build(assets, deps)
        codes = [w.code for w in result.warnings]
        assert ValidationErrorCode.ASSET_NOT_FOUND in codes

    def test_missing_target(self):
        """Check 2 — dependency references non-existent target."""
        assets = [make_asset("A")]
        deps = [make_dep("D1", "A", "MISSING")]
        builder = GraphBuilder()
        result = builder.build(assets, deps)
        codes = [w.code for w in result.warnings]
        assert ValidationErrorCode.ASSET_NOT_FOUND in codes

    def test_duplicate_dependency_id(self):
        """Check 5 — duplicate dependency IDs."""
        assets = [make_asset("A"), make_asset("B"), make_asset("C")]
        deps = [
            make_dep("DUP", "A", "B"),
            make_dep("DUP", "A", "C"),
        ]
        builder = GraphBuilder()
        result = builder.build(assets, deps)
        codes = [w.code for w in result.warnings]
        assert ValidationErrorCode.DUPLICATE_DEPENDENCY_ID in codes

    def test_isolated_assets_detected(self):
        """Check 8 — isolated asset detection."""
        assets = [make_asset("A"), make_asset("B"), make_asset("ISOLATED")]
        deps = [make_dep("D1", "A", "B")]
        builder = GraphBuilder()
        result = builder.build(assets, deps)
        assert "ISOLATED" in result.isolated_assets

    def test_cycles_detected(self):
        """Check 9 — cycles are detected but not errors."""
        assets = [make_asset("A"), make_asset("B"), make_asset("C")]
        deps = [
            make_dep("D1", "A", "B"),
            make_dep("D2", "B", "C"),
            make_dep("D3", "C", "A"),
        ]
        builder = GraphBuilder()
        result = builder.build(assets, deps)
        assert len(result.cycles_detected) > 0

    def test_no_warnings_on_valid_graph(self):
        """Valid graph produces no warnings."""
        _, _, _ = build_basic_graph()
        builder, _, _ = build_basic_graph()
        # Re-run a clean build
        result = builder.build(
            [make_asset("A"), make_asset("B")],
            [make_dep("D1", "A", "B")],
        )
        assert len(result.warnings) == 0
