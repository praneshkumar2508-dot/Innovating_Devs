from pydantic import BaseModel, Field
from typing import Optional

class TelemetryData(BaseModel):
    node_id: str
    timestamp: str
    voltage: Optional[float] = None
    current: Optional[float] = None
    frequency: Optional[float] = None
    power_kw: Optional[float] = None
    load_kw: Optional[float] = None
    temperature: Optional[float] = None
    pressure: Optional[float] = None
    vibration: Optional[float] = None
    fuel_level: Optional[float] = None
    battery_soc: Optional[float] = None
    breaker_status: Optional[str] = None
    operational_state: Optional[str] = None
    sensor_quality: Optional[float] = 1.0
    source: Optional[str] = "SENSOR"
