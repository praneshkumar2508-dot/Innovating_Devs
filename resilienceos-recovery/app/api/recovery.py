from fastapi import APIRouter, HTTPException
from typing import List, Dict
import uuid
from ..models.incident import OptimizationRequest, OptimizationResponse
from ..models.plan import Plan
from ..engine.optimizer import run_optimization

router = APIRouter()

# In-memory database for hackathon
db: Dict[str, OptimizationResponse] = {}

@router.post("/optimize", response_model=OptimizationResponse)
def optimize_recovery(req: OptimizationRequest):
    try:
        opt_id = f"OPT-{uuid.uuid4().hex[:8].upper()}"
        response = run_optimization(opt_id, req)
        db[opt_id] = response
        db[req.incident_id] = response
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/plans/{incident_id}")
def get_plans(incident_id: str):
    if incident_id not in db:
        raise HTTPException(status_code=404, detail="Incident not found")
    res = db[incident_id]
    plans = []
    if res.selected_plan:
        plans.append(res.selected_plan)
    plans.extend(res.alternative_plans)
    return {"plans": plans}

@router.get("/plans/{incident_id}/selected")
def get_selected_plan(incident_id: str):
    if incident_id not in db:
        raise HTTPException(status_code=404, detail="Incident not found")
    if not db[incident_id].selected_plan:
        raise HTTPException(status_code=404, detail="No feasible plan selected")
    return db[incident_id].selected_plan

@router.post("/replan", response_model=OptimizationResponse)
def replan(req: OptimizationRequest):
    # For now, just rerun optimization
    return optimize_recovery(req)

@router.post("/simulate-plan")
def simulate_plan(plan: Plan):
    return {"status": "simulated", "plan": plan}

@router.post("/action-status")
def action_status(action_id: str, status: str):
    return {"action_id": action_id, "status": status}

@router.get("/actions/{incident_id}")
def get_actions(incident_id: str):
    if incident_id not in db:
        raise HTTPException(status_code=404, detail="Incident not found")
    actions = []
    res = db[incident_id]
    if res.selected_plan:
        actions.extend(res.selected_plan.actions)
    for p in res.alternative_plans:
        actions.extend(p.actions)
    return {"actions": [a.dict() for a in actions]}
