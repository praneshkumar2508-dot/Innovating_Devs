"""
FastAPI Backend Server for GraphEngine.
Provides REST APIs for graph inspection, execution, and Server-Sent Events (SSE) streaming.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from graphengine.core.context import ExecutionContext
from graphengine.core.engine import GraphEngine
from graphengine.core.events import GraphEvent, GraphEventType
from graphengine.dsl.serializer import GraphSerializer
from graphengine.examples.async_fetch import build_async_aggregator
from graphengine.examples.branch_pipeline import build_branch_pipeline
from graphengine.examples.data_pipeline import build_data_pipeline

# App initialization
app = FastAPI(
    title="GraphEngine API",
    description="NetworkX-Powered Directed Acyclic Graph Execution & Visualization Engine",
    version="1.0.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registry of active graphs and execution history
GRAPH_REGISTRY: Dict[str, GraphEngine] = {}
EXECUTION_HISTORY: List[Dict[str, Any]] = []


def register_default_graphs():
    """Register built-in showcase workflow graphs."""
    p1 = build_data_pipeline()
    GRAPH_REGISTRY[p1.graph_id] = p1

    p2 = build_branch_pipeline()
    GRAPH_REGISTRY[p2.graph_id] = p2

    p3 = build_async_aggregator()
    GRAPH_REGISTRY[p3.graph_id] = p3


register_default_graphs()

# Static directory setup
STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# --------------------------------------------------------------------------
# API Models
# --------------------------------------------------------------------------

class RunGraphRequest(BaseModel):
    initial_state: Optional[Dict[str, Any]] = None


# --------------------------------------------------------------------------
# REST Endpoints
# --------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    """Serve the Web Visualizer SPA dashboard."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>GraphEngine Visualizer initializing...</h1>")


@app.get("/api/graphs")
async def list_graphs():
    """List all registered graph engines."""
    result = []
    for gid, eng in GRAPH_REGISTRY.items():
        result.append({
            "graph_id": eng.graph_id,
            "name": eng.name,
            "description": eng.description,
            "node_count": eng.nx_graph.number_of_nodes(),
            "edge_count": eng.nx_graph.number_of_edges(),
            "is_dag": eng.is_dag(),
            "generation_count": len(eng.get_parallel_generations()) if eng.is_dag() else 0,
        })
    return result


@app.get("/api/graphs/{graph_id}")
async def get_graph(graph_id: str):
    """Retrieve graph specification, nodes, edges, and parallel generations."""
    if graph_id not in GRAPH_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")
    return GRAPH_REGISTRY[graph_id].to_dict()


@app.post("/api/graphs/{graph_id}/run")
async def run_graph(graph_id: str, payload: RunGraphRequest):
    """Execute graph asynchronously and return summary results."""
    if graph_id not in GRAPH_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")

    engine = GRAPH_REGISTRY[graph_id]
    context = await engine.run_async(initial_state=payload.initial_state)

    summary = context.to_summary_dict()
    # Add detailed node outputs
    summary["node_details"] = {
        nid: res.model_dump() for nid, res in context.node_results.items()
    }
    EXECUTION_HISTORY.append({
        "graph_id": graph_id,
        "run_id": context.run_id,
        "status": context.status,
        "duration_ms": context.total_duration_ms,
        "timestamp": time.time(),
    })
    return summary


@app.get("/api/graphs/{graph_id}/stream")
async def stream_graph_execution(graph_id: str, request: Request, state: Optional[str] = None):
    """
    SSE (Server-Sent Events) endpoint.
    Triggers graph execution and streams live lifecycle events to the browser.
    """
    if graph_id not in GRAPH_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")

    engine = GRAPH_REGISTRY[graph_id]
    queue = engine.events.create_event_queue()

    # Parse initial state if provided
    initial_state = {}
    if state:
        try:
            initial_state = json.loads(state)
        except Exception:
            pass

    async def event_generator():
        # Start execution in background task
        run_task = asyncio.create_task(engine.run_async(initial_state=initial_state))

        try:
            while not run_task.done() or not queue.empty():
                try:
                    # Check for client disconnect
                    if await request.is_disconnected():
                        break

                    event: GraphEvent = await asyncio.wait_for(queue.get(), timeout=0.1)
                    yield f"data: {event.model_dump_json()}\n\n"
                except asyncio.TimeoutError:
                    continue

            # Await completion to catch any unhandled exceptions
            await run_task

        finally:
            engine.events.remove_event_queue(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/api/history")
async def get_history():
    """Retrieve recent execution history."""
    return EXECUTION_HISTORY[-20:]
