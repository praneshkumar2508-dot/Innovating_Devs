"""Cascade simulation API endpoints."""

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    CascadeResult,
    ErrorDetail,
    ErrorResponse,
    ScenarioInput,
)
from app.services.cascade_service import get_cascade_service

router = APIRouter(prefix="/api/v1/cascade", tags=["cascade"])


@router.post("/simulate", response_model=CascadeResult)
async def simulate_cascade(scenario: ScenarioInput):
    """Simulate a failure cascade on the loaded infrastructure graph.

    Accepts one or more root failures and returns the complete cascade
    analysis including affected assets, timeline, impact scores,
    cascade depth, Infrastructure Failure R₀, and dependency paths.

    The graph must be loaded first via POST /api/v1/graph.
    """
    svc = get_cascade_service()
    result = svc.simulate(scenario)

    if isinstance(result, ErrorDetail):
        raise HTTPException(
            status_code=400 if result.code == "GRAPH_VALIDATION_FAILED" else 404,
            detail=ErrorResponse(error=result).model_dump(),
        )

    return result
