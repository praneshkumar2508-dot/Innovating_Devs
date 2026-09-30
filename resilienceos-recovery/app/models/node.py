from pydantic import BaseModel, Field
from typing import List, Optional

class Node(BaseModel):
    node_id: str
    name: str
    sector: str
    node_type: str
    criticality: float = Field(ge=0, le=100)
    capacity: float = Field(ge=0)
    current_load: float = Field(ge=0)
    current_state: str = Field(..., description="E.g., OPERATIONAL, DEGRADED, FAILED")
    backup_capacity: float = Field(default=0, ge=0)
    backup_remaining: float = Field(default=0, ge=0)
    runway_minutes: Optional[int] = Field(default=None)
    repair_duration_minutes: int = Field(ge=0)
    location: str
    skills_required: List[str] = Field(default_factory=list)
    resources_required: List[str] = Field(default_factory=list)
    dependencies: List[str] = Field(default_factory=list)
    dependents: List[str] = Field(default_factory=list)
    alternative_sources: List[str] = Field(default_factory=list)
    access_requirements: List[str] = Field(default_factory=list)
