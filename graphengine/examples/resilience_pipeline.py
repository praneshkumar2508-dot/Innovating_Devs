import math
import random
from typing import Any, Dict, List
from graphengine.core.engine import GraphEngine

def seeded_random(seed: int):
    random.seed(seed)
    return random.random

def simulate_cascade(nodes=None, edges=None, failedNodeIds=None, seed=42, **kwargs: Any) -> Dict[str, Any]:
    if nodes is None: nodes = []
    if edges is None: edges = []
    if failedNodeIds is None: failedNodeIds = []

    rng = seeded_random(seed)
    node_map = {n["id"]: dict(n) for n in nodes}
    failed = set(failedNodeIds)
    propagation_path = []
    step = 0

    # Mark initial failures
    for fid in failedNodeIds:
        if fid in node_map:
            node_map[fid]["health"] = "FAILED"
            node_map[fid]["currentLoad"] = 0

    frontier = list(failedNodeIds)
    while frontier:
        next_frontier = []
        step += 1

        for source_id in frontier:
            out_edges = [e for e in edges if e["source"] == source_id]
            for edge in out_edges:
                target = edge["target"]
                if target in failed:
                    continue
                target_node = node_map.get(target)
                if not target_node:
                    continue

                roll = random.random()
                effective_prob = edge["propagationProbability"] * (0.3 if target_node.get("backupAvailable") else 1.0)

                if roll < effective_prob:
                    failed.add(target)
                    target_node["health"] = "FAILED"
                    target_node["currentLoad"] = 0
                    next_frontier.append(target)
                    propagation_path.append({"from": source_id, "to": target, "step": step})
                elif roll < effective_prob * 1.5:
                    if target_node.get("health") == "HEALTHY":
                        target_node["health"] = "STRESSED"
                        target_node["runwayHours"] = max(1, target_node.get("runwayHours", 24) * 0.5)

        frontier = next_frontier

    failed_nodes = list(failed)
    total_impact = sum(node_map[fid].get("criticality", 0) for fid in failed_nodes if fid in node_map)
    population_affected = sum(node_map[fid].get("populationServed", 0) for fid in failed_nodes if fid in node_map)

    return {
        "nodes": list(node_map.values()),
        "cascadeResult": {
            "failedNodes": failed_nodes,
            "propagationPath": propagation_path,
            "totalImpact": total_impact,
            "populationAffected": population_affected
        }
    }

def calculate_restoration_priority(node: Dict, edges: List[Dict], all_nodes: List[Dict]) -> float:
    if node.get("health") not in ("FAILED", "AT_RISK"):
        return 0

    downstream = [e for e in edges if e["source"] == node["id"]]
    downstream_impact = sum(
        next((n.get("criticality", 0) * n.get("populationServed", 0) / 100000 for n in all_nodes if n["id"] == e["target"]), 0)
        for e in downstream
    )

    runway = node.get("runwayHours", 24)
    urgency = 3 if runway <= 1 else 2 if runway <= 3 else 1
    feasibility = 1 if node.get("accessible", True) else 0.2
    recovery_time = max(1, node.get("recoveryTimeHours", 1))

    return ((downstream_impact * node.get("criticality", 0)) / recovery_time) * urgency * feasibility

def score_plan(nodes: List[Dict], edges: List[Dict], actions: List[Dict]) -> Dict:
    total_crew = sum(a.get("crewRequired", 0) for a in actions)
    max_time = max([a.get("estimatedTimeHours", 1) for a in actions] or [1])

    repairs_hospital = any(a.get("targetNodeId", "").startswith("HC_") or a.get("targetNodeId", "").startswith("PWR_") for a in actions)
    repairs_water = any(a.get("targetNodeId", "").startswith("WTR_") or a.get("targetNodeId", "").startswith("PWR_") for a in actions)

    return {
        "meanRecovery": 0.7 + random.random() * 0.25,
        "worstCaseRecovery": 0.5 + random.random() * 0.35,
        "criticalOutageProbability": 0.05 + random.random() * 0.1 if repairs_hospital else 0.3 + random.random() * 0.2,
        "cascadedFailures": int(random.random() * 5),
        "timeToStabilize": max_time,
        "crewUtilization": min(1.0, total_crew / 10.0),
        "hospitalProtected": repairs_hospital,
        "waterProtected": repairs_water,
    }

def generate_plans(nodes=None, edges=None, **kwargs: Any) -> Dict[str, Any]:
    if nodes is None: nodes = []
    if edges is None: edges = []
    
    failed_nodes = [n for n in nodes if n.get("health") in ("FAILED", "AT_RISK")]
    if not failed_nodes:
        return {"plans": []}

    priorities = [{"node": n, "priority": calculate_restoration_priority(n, edges, nodes)} for n in failed_nodes]
    priorities.sort(key=lambda x: x["priority"], reverse=True)

    # Plan A: Direct repair of highest priority
    plan_a_actions = []
    for i, p in enumerate(priorities[:3]):
        node = p["node"]
        plan_a_actions.append({
            "id": f"a-{i}",
            "type": "REPAIR",
            "targetNodeId": node["id"],
            "description": f"Repair {node.get('name')}",
            "estimatedTimeHours": node.get("recoveryTimeHours", 1),
            "crewRequired": node.get("crewRequirement", 1),
            "priority": i + 1,
        })

    # Plan B: Backup activation
    plan_b_actions = []
    for i, p in enumerate(priorities[:2]):
        node = p["node"]
        plan_b_actions.append({
            "id": f"b-{i}",
            "type": "BACKUP_ACTIVATE",
            "targetNodeId": node["id"],
            "description": f"Activate backup for {node.get('name')}",
            "estimatedTimeHours": node.get("recoveryTimeHours", 1) * 0.3,
            "crewRequired": max(1, node.get("crewRequirement", 2) - 1),
            "priority": i + 1,
        })
    if priorities:
        plan_b_actions.append({
            "id": "b-reroute",
            "type": "REROUTE",
            "targetNodeId": priorities[0]["node"]["id"],
            "description": "Reroute through backup substation",
            "estimatedTimeHours": 2,
            "crewRequired": 2,
            "priority": 3,
        })

    plan_c_actions = [
        {
            "id": "c-0", "type": "DEPLOY_GENERATOR", "targetNodeId": priorities[0]["node"]["id"] if priorities else "",
            "description": "Deploy temporary generator", "estimatedTimeHours": 1.5, "crewRequired": 2, "priority": 1,
        },
        {
            "id": "c-1", "type": "LOAD_SHED", "targetNodeId": priorities[0]["node"]["id"] if priorities else "",
            "description": "Controlled load reduction on non-critical", "estimatedTimeHours": 0.5, "crewRequired": 1, "priority": 2,
        }
    ]

    plans = [
        {
            "id": "plan-a", "name": "Direct Repair", "label": "Plan A", "phase": "RESTORE",
            "actions": plan_a_actions, "metrics": score_plan(nodes, edges, plan_a_actions), "status": "PROPOSED"
        },
        {
            "id": "plan-b", "name": "Backup & Reroute", "label": "Plan B", "phase": "STABILIZE",
            "actions": plan_b_actions, "metrics": score_plan(nodes, edges, plan_b_actions), "status": "PROPOSED"
        },
        {
            "id": "plan-c", "name": "Generator + Controlled Burn", "label": "Plan C", "phase": "STABILIZE",
            "actions": plan_c_actions, "metrics": score_plan(nodes, edges, plan_c_actions), "status": "PROPOSED"
        }
    ]
    return {"plans": plans}

def run_monte_carlo(plans=None, runs=100, **kwargs: Any) -> Dict[str, Any]:
    if plans is None: plans = []
    results = []

    for plan in plans:
        distribution = []
        total_recovery = 0
        hospital_outages = 0
        total_cascade = 0

        for i in range(runs):
            roll = random.random()
            recovery_rate = plan["metrics"]["meanRecovery"] + (roll - 0.5) * 0.3
            clamped = max(0, min(1, recovery_rate))
            distribution.append(clamped)
            total_recovery += clamped

            if random.random() < plan["metrics"]["criticalOutageProbability"]:
                hospital_outages += 1
            total_cascade += int(random.random() * 4)

        distribution.sort()
        p5_idx = int(runs * 0.05)
        p95_idx = int(runs * 0.95)

        results.append({
            "planId": plan["id"],
            "runs": runs,
            "meanRecovery": total_recovery / runs,
            "p5Recovery": distribution[p5_idx] if distribution else 0,
            "p95Recovery": distribution[p95_idx] if distribution else 1,
            "hospitalOutageProb": hospital_outages / runs,
            "cascadeCount": total_cascade / runs,
            "distribution": distribution
        })

    return {"monteCarloResults": results}


def build_resilience_pipeline() -> GraphEngine:
    engine = GraphEngine(
        name="Resilience OS Agentic Pipeline",
        description="Simulates cascades, generates plans, and runs Monte Carlo in sequence."
    )

    # Note: simulate_cascade returns nodes which generate_plans consumes
    engine.add_node("simulate_cascade", simulate_cascade)
    engine.add_node("generate_plans", generate_plans)
    engine.add_node("run_monte_carlo", run_monte_carlo)

    engine.add_edge("simulate_cascade", "generate_plans")
    engine.add_edge("generate_plans", "run_monte_carlo")

    return engine
