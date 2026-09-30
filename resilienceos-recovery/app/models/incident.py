from pydantic import BaseModel, Field
from typing import List, Optional
from .node import Node
from .dependency import Dependency
from .crew import Crew
from .plan import Plan

class OptimizationRequest(BaseModel):
    incident_id: str
    failed_nodes: List[str]
    nodes: List[Node]
    dependencies: List[Dependency]
    crews: List[Crew]
    available_resources: List[str] = Field(default_factory=list)

class OptimizationResponse(BaseModel):
    optimization_id: str
    incident_id: str
    status: str
    selected_plan: Optional[Plan]
    alternative_plans: List[Plan] = Field(default_factory=list)
    infeasible_plans: List[Plan] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)
    decision_reasons: List[str] = Field(default_factory=list)
    replanning: dict = Field(default_factory=lambda: {"required": False, "trigger": None})
