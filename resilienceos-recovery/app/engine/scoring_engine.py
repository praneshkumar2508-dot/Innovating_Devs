from typing import List
from ..models.plan import Plan
from ..models.action import Action
from ..models.node import Node

def score_plan(plan: Plan, actions: List[Action], nodes: List[Node]) -> Plan:
    if not plan.feasible:
        plan.total_score = -9999
        return plan
        
    action_map = {a.action_id: a for a in actions}
    node_map = {n.node_id: n for n in nodes}
    
    # 1. Runway urgency
    urgency_score = plan.minimum_deadline_margin_minutes * 0.5
    
    # 2. Critical dependent services
    critical_services = sum(1 for pa in plan.actions 
                            if node_map.get(action_map[pa.action_id].target_node, Node).sector in ["healthcare", "water", "emergency"])
    plan.critical_services_restored = critical_services
    cs_score = critical_services * 10
    
    # 3. Cascade reduction (Proxy: sum of criticality of restored nodes + their dependents)
    cascade_red = 0
    for pa in plan.actions:
        node = node_map.get(action_map[pa.action_id].target_node)
        if node:
            cascade_red += node.criticality * 20
    plan.cascade_reduction = cascade_red
    
    # 4. Completion time (lower is better)
    time_eff = max(0, 100 - plan.completion_time_minutes) * 0.2
    
    plan.total_score = urgency_score + cs_score + cascade_red + time_eff
    
    return plan
