"""FastAPI application entry point for ResilienceOS Cascade Analyst."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import cascade, graph, health
from app.config import settings
from app.services.cascade_service import get_cascade_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load default data files on startup if they exist."""
    data_dir = Path(__file__).parent.parent / "data"
    assets_file = data_dir / "assets.json"
    deps_file = data_dir / "dependencies.json"
    states_file = data_dir / "states.json"

    if assets_file.exists() and deps_file.exists():
        svc = get_cascade_service()
        response = svc.load_from_files(
            assets_path=assets_file,
            dependencies_path=deps_file,
            states_path=states_file if states_file.exists() else None,
        )
        print(
            f"[Cascade Analyst] Loaded graph: "
            f"{response.node_count} nodes, {response.edge_count} edges, "
            f"{len(response.warnings)} warnings, "
            f"{len(response.cycles_detected)} cycles, "
            f"{len(response.isolated_assets)} isolated."
        )
    else:
        print(
            "[Cascade Analyst] No default data files found in data/. "
            "Use POST /api/v1/graph to load data."
        )

    yield


app = FastAPI(
    title="ResilienceOS Cascade Analyst",
    description=(
        "Deterministic infrastructure cascade-analysis engine. "
        "Accepts an infrastructure dependency graph, state, capacities, "
        "criticality, and backup resources, then mathematically determines "
        "failure propagation, cascade depth, impact scores, and service runway."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router)
app.include_router(graph.router)
app.include_router(cascade.router)

# Serve frontend static files
frontend_dir = Path(__file__).parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
