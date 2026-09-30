import pytest
from app.models.incident import OptimizationRequest
from app.models.node import Node
from app.models.dependency import Dependency
from app.models.crew import Crew
from app.engine.optimizer import run_optimization

# -------------------------------------------------------------------
# Scenario 1 & 2: Basic Optimization & Deadline Check
# -------------------------------------------------------------------
def test_optimizer_basic():
    req = OptimizationRequest(
        incident_id="INC-01",
        failed_nodes=["SUB01"],
        nodes=[
            Node(node_id="SUB01", name="Sub 1", sector="power", node_type="substation", criticality=0.9, capacity=100, current_load=80, current_state="FAILED", repair_duration_minutes=60, location="Z1", skills_required=["electrical"]),
            Node(node_id="WATER01", name="Water 1", sector="water", node_type="plant", criticality=0.95, capacity=100, current_load=50, current_state="DEGRADED", repair_duration_minutes=0, location="Z2", runway_minutes=120)
        ],
        dependencies=[
            Dependency(source="SUB01", target="WATER01", dependency_type="POWER", strength=1.0, required=True, failure_effect="DEGRADED", recovery_effect="OPERATIONAL")
        ],
        crews=[
            Crew(crew_id="C1", skills=["electrical"], current_location="DEPOT", shift_remaining_minutes=480, travel_time={"SUB01": 10})
        ],
        available_resources=[]
    )
    res = run_optimization("OPT-01", req)
    assert res.status == "OPTIMIZED"
    assert res.selected_plan is not None
    assert len(res.selected_plan.actions) == 1
    assert res.selected_plan.actions[0].action_id == "REPAIR_SUB01"
    assert res.selected_plan.actions[0].crew_id == "C1"
    assert res.selected_plan.actions[0].completion_minute == 70

def test_optimizer_deadline_missed():
    req = OptimizationRequest(
        incident_id="INC-02",
        failed_nodes=["SUB01"],
        nodes=[
            Node(node_id="SUB01", name="Sub 1", sector="power", node_type="substation", criticality=0.9, capacity=100, current_load=80, current_state="FAILED", repair_duration_minutes=60, location="Z1", skills_required=["electrical"]),
            Node(node_id="WATER01", name="Water 1", sector="water", node_type="plant", criticality=0.95, capacity=100, current_load=50, current_state="DEGRADED", repair_duration_minutes=0, location="Z2", runway_minutes=30)
        ],
        dependencies=[
            Dependency(source="SUB01", target="WATER01", dependency_type="POWER", strength=1.0, required=True, failure_effect="DEGRADED", recovery_effect="OPERATIONAL")
        ],
        crews=[
            Crew(crew_id="C1", skills=["electrical"], current_location="DEPOT", shift_remaining_minutes=480, travel_time={"SUB01": 10})
        ],
        available_resources=[]
    )
    res = run_optimization("OPT-02", req)
    assert res.status == "NO_FEASIBLE_PLAN"
    assert res.selected_plan is None
    assert len(res.infeasible_plans) > 0
    assert "Deadline missed" in res.infeasible_plans[0].reasons[0]

# -------------------------------------------------------------------
# Scenario 3: Substation repair requires blocked ROAD01 (Prerequisites)
# -------------------------------------------------------------------
def test_blocked_road_prerequisite():
    req = OptimizationRequest(
        incident_id="INC-03",
        failed_nodes=["SUB01"],
        nodes=[
            Node(node_id="SUB01", name="Sub 1", sector="power", node_type="substation", criticality=0.9, capacity=100, current_load=80, current_state="FAILED", repair_duration_minutes=60, location="Z1", skills_required=["electrical"], access_requirements=["ROAD01"]),
            Node(node_id="ROAD01", name="Road 1", sector="roads", node_type="access", criticality=0.5, capacity=100, current_load=0, current_state="FAILED", repair_duration_minutes=20, location="Z1", skills_required=["road_clearing"])
        ],
        dependencies=[],
        crews=[
            Crew(crew_id="ELEC_CREW", skills=["electrical"], current_location="DEPOT", shift_remaining_minutes=480, travel_time={"SUB01": 10}),
            Crew(crew_id="ROAD_CREW", skills=["road_clearing"], current_location="DEPOT", shift_remaining_minutes=480, travel_time={"ROAD01": 5})
        ],
        available_resources=[]
    )
    res = run_optimization("OPT-03", req)
    assert res.status == "OPTIMIZED"
    actions = res.selected_plan.actions
    # Must clear road BEFORE repairing sub
    assert len(actions) == 2
    assert actions[0].action_id == "CLEAR_ROAD01"
    assert actions[1].action_id == "REPAIR_SUB01"
    # Road clearance takes 5 (travel) + 20 (repair) = 25. Sub repair starts at 25 + 10 (travel) = 35. Completes at 35 + 60 = 95.
    assert actions[0].completion_minute == 25
    assert actions[1].start_minute >= 25

# -------------------------------------------------------------------
# Scenario 4: Alternative supply path exists
# -------------------------------------------------------------------
def test_alternative_supply_path():
    req = OptimizationRequest(
        incident_id="INC-04",
        failed_nodes=["SUB01"],
        nodes=[
            Node(node_id="SUB01", name="Sub 1", sector="power", node_type="substation", criticality=0.9, capacity=100, current_load=80, current_state="FAILED", repair_duration_minutes=60, location="Z1", skills_required=["electrical"], alternative_sources=["SUB02"]),
            Node(node_id="SUB02", name="Sub 2", sector="power", node_type="substation", criticality=0.9, capacity=100, current_load=10, current_state="OPERATIONAL", repair_duration_minutes=0, location="Z2", skills_required=[]),
            Node(node_id="HOSP01", name="Hosp 1", sector="healthcare", node_type="hospital", criticality=1.0, capacity=100, current_load=80, current_state="DEGRADED", repair_duration_minutes=0, location="Z3", runway_minutes=20)
        ],
        dependencies=[
            Dependency(source="SUB01", target="HOSP01", dependency_type="POWER", strength=1.0, required=True, failure_effect="DEGRADED", recovery_effect="OPERATIONAL")
        ],
        crews=[
            Crew(crew_id="SWITCH_CREW", skills=["electrical", "switching"], current_location="DEPOT", shift_remaining_minutes=480, travel_time={"SUB01": 5})
        ],
        available_resources=[]
    )
    res = run_optimization("OPT-04", req)
    # The repair of SUB01 takes 60 min, but runway is 20, so repair misses deadline.
    # The TRANSFER_LOAD action takes 15 min + 5 min travel = 20 min, which barely meets runway!
    assert res.status == "OPTIMIZED"
    actions = res.selected_plan.actions
    assert any("TRANSFER" in a.action_id for a in actions)

# -------------------------------------------------------------------
# Scenario 5: Electrical crew unavailable (Infeasible due to skills)
# -------------------------------------------------------------------
def test_crew_unavailable():
    req = OptimizationRequest(
        incident_id="INC-05",
        failed_nodes=["SUB01"],
        nodes=[
            Node(node_id="SUB01", name="Sub 1", sector="power", node_type="substation", criticality=0.9, capacity=100, current_load=80, current_state="FAILED", repair_duration_minutes=60, location="Z1", skills_required=["electrical"])
        ],
        dependencies=[],
        crews=[
            Crew(crew_id="MED_CREW", skills=["medical"], current_location="DEPOT", shift_remaining_minutes=480, travel_time={})
        ],
        available_resources=[]
    )
    res = run_optimization("OPT-05", req)
    assert res.status == "NO_FEASIBLE_PLAN"
    assert "No valid crew found" in res.infeasible_plans[0].reasons[0]

# -------------------------------------------------------------------
# Scenario 8: Two failures simultaneously
# -------------------------------------------------------------------
def test_two_failures_simultaneously():
    req = OptimizationRequest(
        incident_id="INC-08",
        failed_nodes=["SUB01", "SUB02"],
        nodes=[
            Node(node_id="SUB01", name="Sub 1", sector="power", node_type="substation", criticality=0.9, capacity=100, current_load=80, current_state="FAILED", repair_duration_minutes=60, location="Z1", skills_required=["electrical"]),
            Node(node_id="SUB02", name="Sub 2", sector="power", node_type="substation", criticality=0.5, capacity=100, current_load=80, current_state="FAILED", repair_duration_minutes=30, location="Z2", skills_required=["electrical"])
        ],
        dependencies=[],
        crews=[
            Crew(crew_id="ELEC_CREW", skills=["electrical"], current_location="DEPOT", shift_remaining_minutes=480, travel_time={"SUB01": 10, "SUB02": 15})
        ],
        available_resources=[]
    )
    res = run_optimization("OPT-08", req)
    assert res.status == "OPTIMIZED"
    assert len(res.selected_plan.actions) == 2
    # Because SUB01 has higher criticality (0.9 vs 0.5), topological sort "criticality" should pick it first.
    assert res.selected_plan.actions[0].action_id == "REPAIR_SUB01"
    assert res.selected_plan.actions[1].action_id == "REPAIR_SUB02"
    # Action 1 completes at 70 (10 travel + 60 repair)
    assert res.selected_plan.actions[0].completion_minute == 70
    # Action 2 starts at 70 + 15 (travel to Z2, assuming default travel is re-evaluated)
    # The crew's current location becomes SUB01, so travel from SUB01 to SUB02 is default 10min. Start = 70+10=80, end=110.
    assert res.selected_plan.actions[1].completion_minute >= 100 
