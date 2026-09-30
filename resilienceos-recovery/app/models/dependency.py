from pydantic import BaseModel
from typing import Literal

class Dependency(BaseModel):
    source: str
    target: str
    dependency_type: str
    strength: float
    required: bool
    status: Literal["ACTIVE", "INACTIVE", "DEGRADED", "FAILED"] = "ACTIVE"
    failure_effect: str
    recovery_effect: str
