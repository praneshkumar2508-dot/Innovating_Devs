"""Tests for the REST API — Phase 25, 26."""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.services.cascade_service import get_cascade_service


@pytest.fixture(autouse=True)
def reset_service():
    """Reset the service state before each test."""
    import app.services.cascade_service as svc_mod
    svc_mod._service = None
    yield
    svc_mod._service = None


@pytest.mark.asyncio
async def test_health():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"


@pytest.mark.asyncio
async def test_build_graph():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "assets": [
                {
                    "asset_id": "A",
                    "asset_type": "power_station",
                    "name": "Station A",
                    "criticality": 0.9,
                },
                {
                    "asset_id": "B",
                    "asset_type": "hospital",
                    "name": "Hospital B",
                    "criticality": 1.0,
                },
            ],
            "dependencies": [
                {
                    "dependency_id": "D1",
                    "source_asset": "A",
                    "target_asset": "B",
                    "dependency_type": "electricity",
                    "required_capacity": 20,
                    "capacity_unit": "MW",
                }
            ],
        }
        resp = await client.post("/api/v1/graph", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["node_count"] == 2
        assert data["edge_count"] == 1


@pytest.mark.asyncio
async def test_get_graph_without_loading():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/graph")
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_simulate_without_graph():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "root_failures": [{"asset_id": "A", "mode": "complete"}]
        }
        resp = await client.post("/api/v1/cascade/simulate", json=payload)
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_simulate_cascade():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # First build graph
        graph_payload = {
            "assets": [
                {"asset_id": "PWR", "asset_type": "power_station", "name": "Power", "criticality": 0.9,
                 "capacity": {"value": 100, "unit": "MW"}, "current_load": {"value": 60, "unit": "MW"}},
                {"asset_id": "HOSP", "asset_type": "hospital", "name": "Hospital", "criticality": 1.0,
                 "backup": {"type": "generator", "capacity": 30, "fuel_minutes": 90}},
            ],
            "dependencies": [
                {"dependency_id": "D1", "source_asset": "PWR", "target_asset": "HOSP",
                 "dependency_type": "electricity", "required_capacity": 20, "capacity_unit": "MW"}
            ],
        }
        resp = await client.post("/api/v1/graph", json=graph_payload)
        assert resp.status_code == 200

        # Simulate
        sim_payload = {
            "root_failures": [{"asset_id": "PWR", "mode": "complete"}]
        }
        resp = await client.post("/api/v1/cascade/simulate", json=sim_payload)
        assert resp.status_code == 200
        data = resp.json()

        assert "summary" in data
        assert "affected_assets" in data
        assert "timeline" in data
        assert data["summary"]["assets_affected"] > 0


@pytest.mark.asyncio
async def test_simulate_invalid_asset():
    """Phase 26: error for non-existent asset."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Build minimal graph
        graph_payload = {
            "assets": [
                {"asset_id": "A", "asset_type": "x", "name": "A", "criticality": 0.5},
            ],
            "dependencies": [],
        }
        await client.post("/api/v1/graph", json=graph_payload)

        # Simulate with non-existent asset
        sim_payload = {
            "root_failures": [{"asset_id": "NONEXISTENT", "mode": "complete"}]
        }
        resp = await client.post("/api/v1/cascade/simulate", json=sim_payload)
        assert resp.status_code == 404
