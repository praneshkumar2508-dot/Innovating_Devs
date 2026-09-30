"""
Integration tests for GraphEngine FastAPI server endpoints.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from graphengine.server.app import app


@pytest.mark.asyncio
async def test_api_list_graphs():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/graphs")
        assert res.status_code == 200
        data = res.json()
        assert len(data) >= 3
        graph_ids = [g["graph_id"] for g in data]
        assert "customer_churn_pipeline" in graph_ids


@pytest.mark.asyncio
async def test_api_get_graph_details():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/graphs/loan_approval_workflow")
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "Loan Approval & Risk Routing DAG"
        assert len(data["nodes"]) == 5
        assert len(data["edges"]) == 5


@pytest.mark.asyncio
async def test_api_run_graph():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {"initial_state": {"credit_score": 800, "loan_amount": 10000}}
        res = await client.post("/api/graphs/loan_approval_workflow/run", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "COMPLETED"
        assert "node_details" in data
        assert data["node_details"]["approve"]["status"] == "COMPLETED"
