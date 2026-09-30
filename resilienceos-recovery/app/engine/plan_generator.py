from typing import List, Dict, Set
from ..models.action import Action
from ..models.plan import Plan, PlanAction
from ..models.crew import Crew
from ..models.node import Node
import copy
import uuid

def topological_sort_actions(actions: List[Action], prioritize_by="criticality", nodes_map: Dict[str, Node] = None) -> List[Action]:
    # Build graph
    adj = {a.action_id: [] for a in actions}
    in_degree = {a.action_id: 0 for a in actions}
    action_map = {a.action_id: a for a in actions}
    
    # Map node to the action that repairs/clears it
    node_to_action = {}
    for a in actions:
        if a.action_type in ["REPAIR", "CLEAR_ACCESS", "ACTIVATE_BACKUP"]:
            if a.target_node not in node_to_action:
                node_to_action[a.target_node] = []
            node_to_action[a.target_node].append(a.action_id)

    # Build dependencies based on prerequisites
    for a in actions:
        for prereq_node in a.prerequisites:
            if prereq_node in node_to_action:
                for prereq_action_id in node_to_action[prereq_node]:
                    if prereq_action_id in adj:
                        adj[prereq_action_id].append(a.action_id)
                        in_degree[a.action_id] += 1

    # Kahn's algorithm with priority
    queue = [a_id for a_id, deg in in_degree.items() if deg == 0]
    sorted_actions = []
    
    while queue:
        # Sort queue based on priority
        if prioritize_by == "criticality" and nodes_map:
            queue.sort(key=lambda a_id: nodes_map[action_map[a_id].target_node].criticality if action_map[a_id].target_node in nodes_map else 0, reverse=True)
        elif prioritize_by == "time":
            queue.sort(key=lambda a_id: action_map[a_id].repair_duration_minutes)
            
        curr = queue.pop(0)
        sorted_actions.append(action_map[curr])
        
        for neighbor in adj[curr]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)
                
    return sorted_actions

def generate_plans(actions: List[Action], nodes: List[Node]) -> List[Plan]:
    nodes_map = {n.node_id: n for n in nodes}
    
    # Separate actions by target node to find mutually exclusive restorative actions
    # Actions like CLEAR_ACCESS are prerequisites, REPAIR and TRANSFER are mutually exclusive for the same target.
    restorative_actions_by_node = {}
    prereq_actions = []
    
    for a in actions:
        if a.action_type in ["REPAIR", "TRANSFER_LOAD", "ACTIVATE_BACKUP"]:
            if a.target_node not in restorative_actions_by_node:
                restorative_actions_by_node[a.target_node] = []
            restorative_actions_by_node[a.target_node].append(a)
        else:
            prereq_actions.append(a)
            
    import itertools
    # Create all combinations of restorative actions (1 per failed node)
    node_action_lists = list(restorative_actions_by_node.values())
    if not node_action_lists:
        combos = [[]]
    else:
        combos = list(itertools.product(*node_action_lists))
        
    plans = []
    
    for combo in combos:
        # Build action subset
        subset = prereq_actions + list(combo)
        
        plan_a_actions = topological_sort_actions(subset, "criticality", nodes_map)
        plan_b_actions = topological_sort_actions(subset, "time", nodes_map)
        
        for i, act_list in enumerate([plan_a_actions, plan_b_actions]):
            if not act_list:
                continue
            plan_actions = []
            for seq, a in enumerate(act_list):
                plan_actions.append(PlanAction(
                    sequence=seq+1,
                    action_id=a.action_id,
                    start_minute=0, 
                    completion_minute=0,
                    crew_id="" 
                ))
            
            # Ensure unique plans (criticality and time sort might yield same order)
            action_ids = [pa.action_id for pa in plan_actions]
            if not any([pa.action_id for pa in p.actions] == action_ids for p in plans):
                plans.append(Plan(
                    plan_id=f"PLAN_{uuid.uuid4().hex[:4].upper()}",
                    actions=plan_actions
                ))
        
    return plans
