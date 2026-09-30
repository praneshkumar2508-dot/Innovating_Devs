# GraphEngine 🚀

A high-performance Directed Acyclic Graph (DAG) computation and workflow execution engine built on top of **NetworkX**.

GraphEngine provides generation-based parallel asynchronous execution, dynamic conditional branching, automated dataflow parameter mapping, node-level memoization/caching, lifecycle event streaming, a versatile CLI, and an interactive modern web visualizer studio.

---

## 🌟 Key Features

- **NetworkX DiGraph Foundation**: Full topological sorting, cycle detection with cycle pinpointing (`nx.simple_cycles`), generation grouping (`nx.topological_generations`), and transitive ancestor/descendant dependency analysis.
- **Generation-Based Parallelism**: Nodes within the same topological generation run concurrently via `asyncio.gather`, minimizing pipeline execution latency.
- **Smart Dataflow & Signature Matching**: Automatically maps outputs from upstream predecessors directly to target function parameters using Python signature inspection, with fallback to shared graph blackboard state.
- **Conditional Branching & Dynamic Routing**: Edges and nodes support condition predicates, enabling decision trees and multi-path routing with automatic branch skipping and branch convergence.
- **Memoization & Caching**: Cache expensive task outputs based on cryptographic hashes of input parameters (`cacheable=True`).
- **Resilience & Fault Tolerance**: Configurable retry policies with exponential backoff delays and per-node execution timeouts.
- **Fluent Python DSL**:
  - Decorator syntax: `@pipeline.node(...)`
  - Bitwise shift operator syntax: `node_a >> node_b >> [node_c, node_d]`
- **Interactive Web Studio**: Built-in FastAPI backend and glassmorphic HTML5 Canvas/SVG dashboard with real-time Server-Sent Events (SSE) live progress animation and node inspection.
- **Zero-Dependency Core**: Lightweight architecture with minimal overhead.

---

## 📦 Architecture Overview

```
                      ┌───────────────────┐
                      │    GraphEngine    │
                      │ (networkx.DiGraph)│
                      └─────────┬─────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  Generation 1│        │ Generation 2 │        │ Generation 3 │
│  (Ingestion) │───────>│ (Parallel A) │───────>│ (Aggregator) │
└──────────────┘        │ (Parallel B) │        └──────────────┘
                        └──────────────┘
```

---

## 🚀 Quickstart

### 1. Installation

```bash
git clone https://github.com/Innovating_Devs/Innovating_Devs.git
cd Innovating_Devs

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate   # Windows (or `source .venv/bin/activate` on Linux/macOS)

# Install in editable mode
pip install -e .
```

---

## 💻 Python SDK Usage

### 1. Basic Pipeline Execution

```python
from graphengine import GraphEngine

engine = GraphEngine("math_pipeline")

def source():
    return {"base": 10}

def multiply(base: int):
    return {"multiplied": base * 5}

def add(multiplied: int):
    return {"result": multiplied + 25}

# Register nodes
n1 = engine.add_node("source", source)
n2 = engine.add_node("multiply", multiply)
n3 = engine.add_node("add", add)

# Wire dependencies
engine.add_edge("source", "multiply")
engine.add_edge("multiply", "add")

# Run pipeline
context = engine.run()
print("Status:", context.status)
print("Result:", context.get_output("add"))  # {'result': 75}
```

---

### 2. Fluent Bitwise Syntax (`>>`)

```python
from graphengine import GraphEngine

engine = GraphEngine("pipeline")

n1 = engine.add_node("ingest", ingest_fn)
n2a = engine.add_node("feature_a", feat_a_fn)
n2b = engine.add_node("feature_b", feat_b_fn)
n3 = engine.add_node("evaluate", eval_fn)

# n1 runs, then n2a and n2b run in parallel, then n3 joins both!
n1 >> [n2a, n2b] >> n3

context = engine.run()
```

---

### 3. PipelineBuilder Decorator DSL

```python
from graphengine import PipelineBuilder

pipeline = PipelineBuilder(name="nlp_pipeline")

@pipeline.node()
def load_document():
    return {"text": "  NetworkX makes Graph Execution clean and powerful!  "}

@pipeline.node(depends_on="load_document")
def clean_text(text: str):
    return {"cleaned": text.strip().lower()}

@pipeline.node(depends_on="clean_text")
def word_count(cleaned: str):
    words = cleaned.split()
    return {"count": len(words), "words": words}

context = pipeline.run()
print("Word Count:", context.get_output("word_count"))
```

---

### 4. Dynamic Conditional Branching

```python
from graphengine import GraphEngine

engine = GraphEngine("fraud_detection")

engine.add_node("intake", intake_fn)
engine.add_node("risk_scorer", score_risk_fn)
engine.add_node("auto_approve", approve_fn)
engine.add_node("fraud_investigation", audit_fn)
engine.add_node("finalize", finalize_fn)

engine.add_edge("intake", "risk_scorer")

# Branch based on risk score predicate
engine.add_edge("risk_scorer", "auto_approve", condition=lambda out: out["risk_score"] <= 50)
engine.add_edge("risk_scorer", "fraud_investigation", condition=lambda out: out["risk_score"] > 50)

engine.add_edge("auto_approve", "finalize")
engine.add_edge("fraud_investigation", "finalize")

# Executes only the matching branch, skipping the other
context = engine.run({"credit_score": 780})
```

---

## 🛠️ Command Line Interface (CLI)

GraphEngine includes a built-in CLI:

```bash
# List available showcase workflows
python -m graphengine.cli list

# Inspect DAG topology and topological generations
python -m graphengine.cli inspect churn
python -m graphengine.cli inspect loan

# Run workflow directly from terminal with initial state
python -m graphengine.cli run loan --state '{"credit_score": 820, "loan_amount": 15000}'

# Launch the Web Visualizer Studio & REST API
python -m graphengine.cli serve --host 127.0.0.1 --port 8000
```

---

## 🌐 Interactive Web Visualizer Studio

Run `python -m graphengine.cli serve` and open [http://127.0.0.1:8000](http://127.0.0.1:8000):

- **Interactive Canvas**: Visualizes nodes ordered by topological execution layers with directional Bezier curves.
- **Real-Time Execution Animation**: Watch nodes transition through `PENDING` ➔ `RUNNING` (pulsing cyan glow) ➔ `COMPLETED` (emerald green) or `FAILED` (crimson red) via Server-Sent Events (SSE).
- **Node Inspector Drawer**: Click on any node to view its inputs, outputs, runtime latency, retry metrics, and execution status.
- **Initial State Editor**: Test workflows with custom JSON parameters.
- **Live Event Stream**: Real-time telemetry log tracking every lifecycle event.

---

## 🧪 Running Tests

The test suite covers linear pipelines, cycle detection, retries, caching, concurrency speedup, and FastAPI endpoints:

```bash
pytest -v
```

```
tests/test_api.py::test_api_list_graphs PASSED
tests/test_api.py::test_api_get_graph_details PASSED
tests/test_api.py::test_api_run_graph PASSED
tests/test_branching.py::test_conditional_branching PASSED
tests/test_branching.py::test_node_level_condition PASSED
tests/test_concurrency.py::test_parallel_async_execution PASSED
tests/test_core_engine.py::test_basic_linear_execution PASSED
tests/test_core_engine.py::test_cycle_detection PASSED
tests/test_core_engine.py::test_node_retry_policy PASSED
tests/test_core_engine.py::test_node_caching PASSED
tests/test_core_engine.py::test_node_not_found PASSED
tests/test_core_engine.py::test_topological_generations PASSED
========================== 12 passed in 0.87s ==========================
```

---

## 📄 License

MIT License. Designed and developed by **Innovating_Devs**.