"""Health-check API endpoints."""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    """Basic liveness check."""
    return {"status": "healthy", "service": "ResilienceOS Cascade Analyst"}


@router.get("/ready")
async def readiness_check():
    """Readiness check — returns whether a graph is loaded."""
    from app.services.cascade_service import get_cascade_service
    svc = get_cascade_service()
    return {
        "ready": svc.is_loaded,
        "graph_loaded": svc.is_loaded,
        "node_count": svc.graph.number_of_nodes() if svc.is_loaded else 0,
        "edge_count": svc.graph.number_of_edges() if svc.is_loaded else 0,
    }
