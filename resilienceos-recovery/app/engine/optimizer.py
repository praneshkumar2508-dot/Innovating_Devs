from ..models.incident import OptimizationRequest, OptimizationResponse
from .action_generator import generate_candidate_actions
from .plan_generator import generate_plans
from .plan_simulator import simulate_plan
from .scoring_engine import score_plan
import copy

def run_optimization(opt_id: str, req: OptimizationRequest) -> OptimizationResponse:
    actions = generate_candidate_actions(req.failed_nodes, req.nodes, req.dependencies)
    plans = generate_plans(actions, req.nodes)
    
    feasible_plans = []
    infeasible_plans = []
    
    for plan in plans:
        # Simulate
        simulated_plan = simulate_plan(plan, actions, req.crews, req.nodes, req.available_resources, req.dependencies)
        
        # Score
        scored_plan = score_plan(simulated_plan, actions, req.nodes)
        
        if scored_plan.feasible:
            feasible_plans.append(scored_plan)
        else:
            infeasible_plans.append(scored_plan)
            
    # Rank feasible plans
    feasible_plans.sort(key=lambda p: p.total_score, reverse=True)
    
    for i, p in enumerate(feasible_plans):
        p.rank = i + 1
        
    selected = feasible_plans[0] if feasible_plans else None
    alternative = feasible_plans[1:] if len(feasible_plans) > 1 else []
    
    reasons = []
    if selected:
        reasons.append(f"Selected {selected.plan_id} with score {selected.total_score} due to fastest completion time and critical services restored.")
    else:
        reasons.append("No feasible plan exists. All generated plans failed constraints.")
        
    return OptimizationResponse(
        optimization_id=opt_id,
        incident_id=req.incident_id,
        status="OPTIMIZED" if selected else "NO_FEASIBLE_PLAN",
        selected_plan=selected,
        alternative_plans=alternative,
        infeasible_plans=infeasible_plans,
        decision_reasons=reasons
    )
