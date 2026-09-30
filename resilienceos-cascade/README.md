# ResilienceOS Cascade Analyst

**Deterministic infrastructure cascade-analysis engine** that mathematically determines failure propagation through infrastructure dependency networks.

## What It Does

Given an infrastructure dependency graph, asset states, capacities, criticality scores, and backup resources, the Cascade Analyst computes:

| Output | Description |
|---|---|
| **Directly affected assets** | Assets that depend on the failed asset(s) |
| **Indirectly affected assets** | Downstream cascading impacts |
| **Failed services** | Services that cannot operate |
| **At-risk services** | Services running on backup / degraded |
| **Protected services** | Services with sufficient redundancy |
| **Cascade depth** | How deep the failure propagates |
| **Infrastructure Failure R₀** | Average downstream failures per root failure |
| **Service runway** | How long backups last (minutes) |
| **Criticality-weighted impact** | Impact score = criticality × dependency_loss × time_urgency |
| **Population impact** | Affected population when data exists |
| **Alternative supply** | Feasibility of alternative suppliers |
| **Dependency paths** | Exact chains of dependency causing each impact |
| **Timeline** | Chronological cascade events |

## Architecture

```
                    INPUT DATA
                        │
          ┌─────────────┼─────────────┐
          ↓             ↓             ↓
       Assets       Dependencies   State
          │             │             │
          └─────────────┼─────────────┘
                        ↓
                 Graph Builder
                        ↓
                NetworkX DiGraph
                        ↓
                 Failure Scenario
                        ↓
               Cascade Engine
                        ↓
          ┌─────────────┼─────────────┐
          ↓             ↓             ↓
    Dependency      Capacity       Redundancy
    Propagation      Analysis       Analysis
          │             │             │
          └─────────────┼─────────────┘
                        ↓
                 Runway Engine
                        ↓
               Criticality Engine
                        ↓
                 Impact Ranking
                        ↓
              Cascade R₀ / Depth
                        ↓
                 Final Analysis
                        ↓
                 REST API / JSON
```

The engine is **purely deterministic** — no LLM is involved in the cascade calculation.

## Quick Start

### Install

```bash
cd resilienceos-cascade
pip install -r requirements.txt
```

### Run

```bash
uvicorn app.main:app --reload --port 8000
```

The server auto-loads `data/assets.json`, `data/dependencies.json`, and `data/states.json` on startup.

### Test

```bash
pytest tests/ -v
```

### Docker

```bash
docker build -t cascade-analyst .
docker run -p 8000:8000 cascade-analyst
```

## API Reference

### Health

```
GET /health           → {"status": "healthy"}
GET /ready            → {"ready": true, "node_count": 11, ...}
```

### Graph Management

```
POST /api/v1/graph    → Build graph from JSON payload
GET  /api/v1/graph    → Inspect loaded graph (nodes + edges)
```

### Cascade Simulation

```
POST /api/v1/cascade/simulate
```

**Complete failure:**
```json
{
  "root_failures": [
    {"asset_id": "POWER_A", "mode": "complete"}
  ]
}
```

**Partial failure:**
```json
{
  "root_failures": [
    {"asset_id": "POWER_A", "mode": "capacity_reduction", "remaining_capacity_percent": 40}
  ]
}
```

**Multiple failures:**
```json
{
  "root_failures": [
    {"asset_id": "POWER_A", "mode": "complete"},
    {"asset_id": "TELECOM_02", "mode": "complete"}
  ]
}
```

## Impact Score Formula

```
impact_score = criticality × dependency_loss × time_urgency
```

| Term | Range | Definition |
|---|---|---|
| `criticality` | [0, 1] | From input asset data |
| `dependency_loss` | [0, 1] | Fraction of dependencies unsatisfied |
| `time_urgency` | [0, 1] | 1.0 = no backup; decreases with runway |

### Severity Classification

| Score | Severity |
|---|---|
| 0.00 – 0.24 | LOW |
| 0.25 – 0.49 | MODERATE |
| 0.50 – 0.74 | HIGH |
| 0.75 – 1.00 | CRITICAL |

Thresholds are configurable via environment variables.

## Infrastructure Failure R₀

**Cascade Reproduction Factor** — the average number of newly failed/affected downstream assets directly caused by one failed asset.

```
R₀ = total direct downstream state changes / number of root failures
```

This is NOT epidemiological R₀. It is an infrastructure-specific metric.

## Asset States

| State | Meaning |
|---|---|
| `OPERATIONAL` | Fully functioning |
| `PROTECTED` | Has backup or redundant supply |
| `AT_RISK` | Running on finite backup |
| `DEGRADED` | Partial capacity loss |
| `FAILED` | Cannot function |
| `UNKNOWN` | Insufficient data |

## Adding New Infrastructure

Edit `data/assets.json` and `data/dependencies.json`, or POST to `/api/v1/graph`. No code changes required.

**Supported dependency types:** electricity, water, telecommunications, transport, fuel, cooling, data.

New asset types are automatically accepted — the engine does not hard-code behavior per type.

## Design Decisions

1. **No recovery decisions** — the Cascade Analyst identifies feasibility; the Recovery Optimizer decides actions.
2. **No LLM for computation** — all cascade results are deterministic.
3. **Data-driven** — new infrastructure types require zero code changes.
4. **Separation of concerns** — each engine (propagation, capacity, redundancy, runway, criticality, impact) is independent.

## Project Structure

```
resilienceos-cascade/
├── app/
│   ├── main.py                    # FastAPI entry point
│   ├── config.py                  # Settings & thresholds
│   ├── api/
│   │   ├── cascade.py             # POST /cascade/simulate
│   │   ├── graph.py               # POST/GET /graph
│   │   └── health.py              # Health checks
│   ├── core/
│   │   ├── graph_builder.py       # NetworkX graph construction
│   │   ├── cascade_engine.py      # Central orchestrator
│   │   ├── propagation_engine.py  # BFS cascade propagation
│   │   ├── capacity_engine.py     # Capacity analysis
│   │   ├── redundancy_engine.py   # Redundant supply analysis
│   │   ├── runway_engine.py       # Backup duration & timeline
│   │   ├── criticality_engine.py  # Criticality weighting
│   │   └── impact_engine.py       # Impact scoring & ranking
│   ├── models/
│   │   ├── schemas.py             # Pydantic models
│   │   └── enums.py               # Enumerations
│   └── services/
│       └── cascade_service.py     # Service layer
├── data/                          # Infrastructure data (JSON)
├── tests/                         # pytest test suite
├── frontend/                      # Visualization UI
├── requirements.txt
├── Dockerfile
└── README.md
```
