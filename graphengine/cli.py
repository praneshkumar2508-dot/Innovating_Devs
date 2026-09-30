"""
Command Line Interface (CLI) for GraphEngine.
Provides tools to inspect, execute, and serve workflows directly from terminal.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

from graphengine.core.engine import GraphEngine
from graphengine.dsl.serializer import GraphSerializer
from graphengine.examples.async_fetch import build_async_aggregator
from graphengine.examples.branch_pipeline import build_branch_pipeline
from graphengine.examples.data_pipeline import build_data_pipeline

BUILTIN_EXAMPLES = {
    "data_pipeline": build_data_pipeline,
    "churn": build_data_pipeline,
    "branch_pipeline": build_branch_pipeline,
    "loan": build_branch_pipeline,
    "async_fetch": build_async_aggregator,
    "crypto": build_async_aggregator,
}


def load_engine_from_arg(arg: str) -> GraphEngine:
    """Load engine from built-in name or file path."""
    if arg in BUILTIN_EXAMPLES:
        return BUILTIN_EXAMPLES[arg]()

    path = Path(arg)
    if path.exists():
        return GraphSerializer.load_file(path)

    raise ValueError(f"Unknown graph or file not found: '{arg}'. Available built-ins: {list(BUILTIN_EXAMPLES.keys())}")


def cmd_list(args):
    """List available built-in workflows."""
    print("GraphEngine Built-in Showcase Workflows:")
    for name, factory in BUILTIN_EXAMPLES.items():
        eng = factory()
        print(f"  • {name:16} - {eng.name} ({eng.nx_graph.number_of_nodes()} nodes, {eng.nx_graph.number_of_edges()} edges)")


def cmd_inspect(args):
    """Inspect a graph's topological generations and metadata."""
    engine = load_engine_from_arg(args.target)
    print("=" * 60)
    print(f"Graph ID:    {engine.graph_id}")
    print(f"Name:        {engine.name}")
    print(f"Description: {engine.description}")
    print(f"Nodes:       {engine.nx_graph.number_of_nodes()}")
    print(f"Edges:       {engine.nx_graph.number_of_edges()}")
    print(f"Is DAG:      {engine.is_dag()}")
    print("=" * 60)

    if engine.is_dag():
        print("\nTopological Generations (Parallel Concurrency Layers):")
        for i, gen in enumerate(engine.get_parallel_generations()):
            print(f"  Layer {i+1}: {gen}")

    print("\nNode Details:")
    for nid, data in engine.nx_graph.nodes(data=True):
        node = data["obj"]
        preds = list(engine.nx_graph.predecessors(nid))
        succs = list(engine.nx_graph.successors(nid))
        print(f"  [{nid}] '{node.name}' (async={node.is_async})")
        if preds:
            print(f"     <- Depends on: {preds}")
        if succs:
            print(f"     -> Triggers:   {succs}")


def cmd_run(args):
    """Execute a graph workflow."""
    engine = load_engine_from_arg(args.target)
    initial_state: Dict[str, Any] = {}
    if args.state:
        try:
            initial_state = json.loads(args.state)
        except Exception as e:
            print(f"Error parsing --state JSON: {e}", file=sys.stderr)
            sys.exit(1)

    print(f"Executing '{engine.name}' (ID: {engine.graph_id})...")
    context = engine.run(initial_state=initial_state)

    print("\n" + "=" * 60)
    print(f"Execution Status: {context.status} ({context.total_duration_ms}ms)")
    print(f"Nodes Executed:   {len(context.execution_order)}")
    print(f"Execution Order:  {context.execution_order}")
    print("=" * 60)

    if context.error:
        print(f"\nError: {context.error}")

    print("\nOutputs:")
    for nid, res in context.node_results.items():
        print(f"  • {nid} [{res.status.value}] ({res.execution_time_ms}ms): {res.output}")


def cmd_serve(args):
    """Start the FastAPI server & web visualizer dashboard."""
    import uvicorn
    from graphengine.server.app import app

    print(f"\n🚀 Starting GraphEngine Studio on http://{args.host}:{args.port}")
    print("   Open your browser to access the interactive DAG visualizer.\n")
    uvicorn.run(app, host=args.host, port=args.port)


def main():
    parser = argparse.ArgumentParser(
        prog="graphengine",
        description="GraphEngine: NetworkX-Powered DAG Computation Engine",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # list
    p_list = subparsers.add_parser("list", help="List built-in showcase workflows")
    p_list.set_defaults(func=cmd_list)

    # inspect
    p_inspect = subparsers.add_parser("inspect", help="Inspect graph topology and generations")
    p_inspect.add_argument("target", help="Built-in name or JSON/YAML file path")
    p_inspect.set_defaults(func=cmd_inspect)

    # run
    p_run = subparsers.add_parser("run", help="Execute a graph workflow")
    p_run.add_argument("target", help="Built-in name or JSON/YAML file path")
    p_run.add_argument("--state", "-s", help="Initial state JSON string", default="{}")
    p_run.set_defaults(func=cmd_run)

    # serve
    p_serve = subparsers.add_parser("serve", help="Launch web visualizer & REST API")
    p_serve.add_argument("--host", default="127.0.0.1", help="Host interface (default: 127.0.0.1)")
    p_serve.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    p_serve.set_defaults(func=cmd_serve)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
