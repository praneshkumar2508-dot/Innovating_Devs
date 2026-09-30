from pydantic import BaseModel, Field
from typing import List, Optional

class Action(BaseModel):
    action_id: str
    action_type: str
    target_node: str
    required_skills: List[str] = Field(default_factory=list)
    required_resources: List[str] = Field(default_factory=list)
    repair_duration_minutes: int
    travel_duration_minutes: int = 0
    prerequisites: List[str] = Field(default_factory=list)
    blocks: List[str] = Field(default_factory=list)
    unblocks: List[str] = Field(default_factory=list)
    expected_effect: str
    risk: float = 0.0
    reversible: bool = False
