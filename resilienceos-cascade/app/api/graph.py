"""Graph management API endpoints."""

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    ErrorDetail,
    ErrorResponse,
    GraphBuildRequest,
    GraphBuildResponse,
    GraphInfo,
)
from app.services.cascade_service import get_cascade_service

router = APIRouter(prefix="/api/v1/graph", tags=["graph"])


@router.post("", response_model=GraphBuildResponse)
async def build_graph(request: GraphBuildRequest):
    """Build the infrastructure dependency graph from supplied data.

    Accepts assets, dependencies, and optional state overrides.
    Returns validation results including warnings, cycles, and
    isolated assets.
    """
    svc = get_cascade_service()
    response = svc.build_graph(request)
    return response


@router.get("", response_model=GraphInfo)
async def get_graph():
    """Inspect the currently loaded infrastructure graph.

    Returns all nodes (assets) and edges (dependencies) with metadata.
    """
    svc = get_cascade_service()
    result = svc.get_graph_info()

    if isinstance(result, ErrorDetail):
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error=result).model_dump(),
        )

    return result
