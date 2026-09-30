from pydantic import BaseModel, Field
from typing import List, Dict

class Crew(BaseModel):
    crew_id: str
    skills: List[str]
    current_location: str
    available_at: int = 0
    availability_status: str = "AVAILABLE"
    max_concurrent_jobs: int = 1
    travel_time: Dict[str, int] = Field(default_factory=dict)
    equipment: List[str] = Field(default_factory=list)
    resources: List[str] = Field(default_factory=list)
    shift_remaining_minutes: int
