import math
from typing import Dict, Any, Tuple
import datetime

class DummyModel:
    def __init__(self):
        # Weights for [load_ratio, voltage_deviation, temperature, temperature_trend, vibration]
        self.weights = [2.5, 5.0, 0.05, 0.1, 0.5]
        self.bias = -7.0
        self.feature_names = ["load_ratio", "voltage_deviation", "temperature", "temperature_trend", "vibration"]
        
    def predict_proba(self, features: Dict[str, float]) -> float:
        x = [
            features.get("load_ratio", 0.0),
            features.get("voltage_deviation", 0.0),
            features.get("temperature", 50.0),
            features.get("temperature_trend", 0.0),
            features.get("vibration", 0.0)
        ]
        
        # Calculate logit
        z = self.bias + sum(w * val for w, val in zip(self.weights, x))
        
        # Sigmoid function
        prob = 1.0 / (1.0 + math.exp(-z))
        return prob


class PredictiveAnalyst:
    def __init__(self):
        # We simulate having a real trained model here.
        # In a real app this would load from a saved pickle file.
        self.model = DummyModel()
        self.version = "predictive_model_v1.0"
        
    def analyze(self, features: Dict[str, float], node_id: str) -> Dict[str, Any]:
        prob = self.model.predict_proba(features)
        
        # Calculate horizons (naive scaling for MVP)
        p_10 = prob * 0.5
        p_30 = prob
        p_60 = min(prob * 1.2, 0.99)
        
        # Risk classification
        if p_30 > 0.8:
            risk = "CRITICAL"
        elif p_30 > 0.6:
            risk = "HIGH"
        elif p_30 > 0.3:
            risk = "MEDIUM"
        else:
            risk = "LOW"
            
        evidence = []
        for fn in self.model.feature_names:
            val = features.get(fn, 0)
            if val > 0:
                evidence.append({
                    "feature": fn,
                    "value": val,
                    "contribution": val * 0.1  # mock contribution
                })
        
        return {
            "prediction_id": f"PRED-{int(datetime.datetime.now().timestamp())}",
            "node_id": node_id,
            "failure_type": "OVERLOAD" if features.get("load_ratio", 0) > 1.0 else "UNKNOWN",
            "horizons": {
                "10_min": p_10,
                "30_min": p_30,
                "60_min": p_60
            },
            "risk_level": risk,
            "risk_momentum": 0.0,
            "evidence": evidence,
            "model_version": self.version,
            "data_timestamp": datetime.datetime.now().isoformat(),
            "confidence": 0.85,
            "prediction_method": "LogisticRegression",
            "data_status": "FRESH",
            "prediction_valid": True
        }
