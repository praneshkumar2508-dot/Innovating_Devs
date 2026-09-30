from typing import List, Dict, Optional
from ..models.plan import Plan
from ..models.crew import Crew
from ..models.action import Action
from ..models.node import Node
from ..models.dependency import Dependency
import copy

def find_best_crew(action: Action, crews: List[Crew], current_time: int) -> Optional[Crew]:
    best_crew = None
    best_available_time = 999999
    
    for crew in crews:
        # Check skills
        if not all(skill in crew.skills for skill in action.required_skills):
            continue
            
        # Check resources
        if not all(res in crew.resources for res in action.required_resources):
            continue
            
        # Calculate arrival time
        travel_time = crew.travel_time.get(action.target_node, 10) # default 10 min
        available_at = max(current_time, crew.available_at) + travel_time
        
        if available_at < best_available_time:
            best_available_time = available_at
            best_crew = crew
            
    return best_crew

def simulate_plan(plan: Plan, actions: List[Action], crews: List[Crew], nodes: List[Node], resources: List[str], dependencies: List[Dependency] = None) -> Plan:
    if dependencies is None:
        dependencies = []
    
    action_map = {a.action_id: a for a in actions}
    node_map = {n.node_id: n for n in nodes}
    
    # Map source node to its dependent targets
    node_to_dependents = {n.node_id: [] for n in nodes}
    for dep in dependencies:
        if dep.source in node_to_dependents:
            node_to_dependents[dep.source].append(dep.target)
            
    sim_crews = copy.deepcopy(crews)
    sim_resources = copy.deepcopy(resources)
    
    current_time = 0
    node_availability_times = {} # When does a node become available?
    
    reasons = []
    
    for plan_action in plan.actions:
        action = action_map[plan_action.action_id]
        
        # Check prerequisites
        prereq_time = current_time
        for prereq in action.prerequisites:
            if prereq in node_availability_times:
                prereq_time = max(prereq_time, node_availability_times[prereq])
            else:
                req_node = node_map.get(prereq)
                if req_node and req_node.current_state != "OPERATIONAL":
                    # Prerequisite not met and not scheduled
                    plan.feasible = False
                    reasons.append(f"Prerequisite {prereq} not satisfied for {action.action_id}")
                    break
        
        if not plan.feasible:
            break
            
        # Find crew
        crew = find_best_crew(action, sim_crews, prereq_time)
        if not crew:
            plan.feasible = False
            reasons.append(f"No valid crew found for {action.action_id}")
            break
            
        travel_time = crew.travel_time.get(action.target_node, 10)
        start_time = max(prereq_time, crew.available_at) + travel_time
        completion_time = start_time + action.repair_duration_minutes
        
        # Update crew state
        crew.available_at = completion_time
        crew.current_location = action.target_node
        
        # Consume resources
        for res in action.required_resources:
            if res in sim_resources:
                sim_resources.remove(res)
            elif res in crew.resources:
                crew.resources.remove(res)
            else:
                plan.feasible = False
                reasons.append(f"Resource {res} exhausted")
                break
                
        if not plan.feasible:
            break
            
        # Update action
        plan_action.start_minute = start_time
        plan_action.completion_minute = completion_time
        plan_action.crew_id = crew.crew_id
        
        node_availability_times[action.target_node] = completion_time
        plan.completion_time_minutes = max(plan.completion_time_minutes, completion_time)
        
        # Deadline check (Runway) for the target node AND its dependents
        nodes_to_check = [action.target_node] + node_to_dependents.get(action.target_node, [])
        for n_id in nodes_to_check:
            n = node_map.get(n_id)
            if n and n.runway_minutes is not None:
                margin = n.runway_minutes - completion_time
                if margin < 0:
                    plan.feasible = False
                    reasons.append(f"Deadline missed for {n.node_id}. Margin: {margin}")
                    break
        if not plan.feasible:
            break
            
    if plan.feasible:
        # Calculate margins
        margins = []
        for plan_action in plan.actions:
            action = action_map[plan_action.action_id]
            nodes_to_check = [action.target_node] + node_to_dependents.get(action.target_node, [])
            for n_id in nodes_to_check:
                n = node_map.get(n_id)
                if n and n.runway_minutes is not None:
                    margins.append(n.runway_minutes - plan_action.completion_minute)
        
        if margins:
            plan.minimum_deadline_margin_minutes = min(margins)
        
        plan.crew_count = len(set(pa.crew_id for pa in plan.actions))
        
    plan.reasons = reasons
    return plan
