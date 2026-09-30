from pydantic import BaseModel
from typing import List, Optional

class NodeProfile(BaseModel):
    node_id: str
    name: str
    sector: str
    node_type: str
    criticality: float
    rated_capacity: float
    normal_operating_range: dict = {}
    dependencies: List[str] = []
    dependents: List[str] = []
    location: str = ""
    equipment_age: float = 0
    maintenance_interval: float = 365
    last_maintenance: str = ""
    backup_available: bool = False
