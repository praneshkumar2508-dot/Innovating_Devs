from typing import List
from ..models.node import Node
from ..models.dependency import Dependency
from ..models.action import Action

def generate_candidate_actions(failed_nodes: List[str], nodes: List[Node], dependencies: List[Dependency]) -> List[Action]:
    actions = []
    node_map = {n.node_id: n for n in nodes}
    
    for fn_id in failed_nodes:
        node = node_map.get(fn_id)
        if not node:
            continue
            
        # Action 1: Repair the node
        actions.append(Action(
            action_id=f"REPAIR_{fn_id}",
            action_type="REPAIR",
            target_node=fn_id,
            required_skills=node.skills_required,
            required_resources=node.resources_required,
            repair_duration_minutes=node.repair_duration_minutes,
            prerequisites=node.access_requirements,
            expected_effect=f"Restore {fn_id}"
        ))
        
        # Action 2: Activate backup (if applicable)
        if node.backup_capacity > 0:
            actions.append(Action(
                action_id=f"BACKUP_{fn_id}",
                action_type="ACTIVATE_BACKUP",
                target_node=fn_id,
                required_skills=[],
                required_resources=[],
                repair_duration_minutes=5,  # quick to activate
                prerequisites=[],
                expected_effect=f"Activate backup for {fn_id}"
            ))

        # Action 3: Alternative source transfer
        for alt_src in node.alternative_sources:
            actions.append(Action(
                action_id=f"TRANSFER_{fn_id}_TO_{alt_src}",
                action_type="TRANSFER_LOAD",
                target_node=fn_id,
                required_skills=["switching"] if node.sector == "power" else [],
                required_resources=[],
                repair_duration_minutes=15,
                prerequisites=[alt_src],  # alternative source must be operational
                expected_effect=f"Transfer {fn_id} load to {alt_src}"
            ))
            
        # Action 4: Clear access blockages
        for req in node.access_requirements:
            req_node = node_map.get(req)
            if req_node and req_node.current_state != "OPERATIONAL":
                actions.append(Action(
                    action_id=f"CLEAR_{req}",
                    action_type="CLEAR_ACCESS",
                    target_node=req,
                    required_skills=req_node.skills_required,
                    required_resources=req_node.resources_required,
                    repair_duration_minutes=req_node.repair_duration_minutes,
                    prerequisites=[],
                    expected_effect=f"Clear access route {req}"
                ))

    # Deduplicate actions
    unique_actions = {a.action_id: a for a in actions}
    return list(unique_actions.values())
