from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from pydantic import BaseModel
from app.models.telemetry import TelemetryData
from app.models.node import NodeProfile
from app.models.prediction import PredictionOutput
from app.features.feature_engineering import extract_features
from app.prediction.predictor import PredictiveAnalyst

router = APIRouter()
analyst = PredictiveAnalyst()

class PredictRequest(BaseModel):
    node: NodeProfile
    telemetry_history: List[TelemetryData]

@router.post("/predict", response_model=PredictionOutput)
def predict_node(req: PredictRequest):
    if not req.telemetry_history:
        raise HTTPException(status_code=400, detail="INSUFFICIENT_DATA")
        
    features = extract_features([t.dict() for t in req.telemetry_history], req.node.dict())
    
    result = analyst.analyze(features, req.node.node_id)
    return PredictionOutput(**result)

@router.post("/batch", response_model=List[PredictionOutput])
def predict_batch(reqs: List[PredictRequest]):
    results = []
    for req in reqs:
        try:
            if not req.telemetry_history:
                continue
            features = extract_features([t.dict() for t in req.telemetry_history], req.node.dict())
            result = analyst.analyze(features, req.node.node_id)
            results.append(PredictionOutput(**result))
        except Exception as e:
            continue
    return results
