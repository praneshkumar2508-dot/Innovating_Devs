from pydantic import BaseModel, Field
from typing import List, Optional

class PlanAction(BaseModel):
    sequence: int
    action_id: str
    start_minute: int
    completion_minute: int
    crew_id: str

class Plan(BaseModel):
    plan_id: str
    rank: int = 1
    total_score: float = 0.0
    feasible: bool = True
    actions: List[PlanAction] = Field(default_factory=list)
    impact_reduction: float = 0.0
    cascade_reduction: float = 0.0
    critical_services_restored: int = 0
    completion_time_minutes: int = 0
    resource_cost: float = 0.0
    crew_count: int = 0
    travel_time_minutes: int = 0
    minimum_deadline_margin_minutes: int = 0
    robustness_score: float = 0.0
    reasons: List[str] = Field(default_factory=list)
