from pydantic import BaseModel
from typing import List, Dict, Optional

class EvidenceFeature(BaseModel):
    feature: str
    value: float
    contribution: float

class PredictionOutput(BaseModel):
    prediction_id: str
    node_id: str
    failure_type: str = "UNKNOWN"
    horizons: Dict[str, float]  # e.g. {"10_min": 0.42, "30_min": 0.71}
    risk_level: str
    risk_momentum: float = 0.0
    evidence: List[EvidenceFeature]
    model_version: str
    data_timestamp: str
    confidence: float
    prediction_method: str = "LogisticRegression"
    data_status: str = "FRESH"
    prediction_valid: bool = True
