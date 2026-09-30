"""
Example: End-to-end Data Processing and Model Scoring Pipeline.
Demonstrates generation-based parallel execution, data mapping, and caching.
"""

import asyncio
import time
from typing import Any, Dict, List
from graphengine import GraphEngine, Node


def build_data_pipeline() -> GraphEngine:
    engine = GraphEngine(
        graph_id="customer_churn_pipeline",
        name="Customer Churn Prediction DAG",
        description="Extracts customer metrics, extracts features in parallel, scores ML model, and generates alerts.",
        enable_cache=True,
    )

    # 1. Ingestion Node
    def ingest_data(batch_size: int = 5) -> Dict[str, Any]:
        """Simulate ingesting raw records."""
        time.sleep(0.05)
        raw_records = [
            {"id": f"cust_{i}", "tenure_months": 3 * i, "monthly_spend": 50 + 20 * i, "support_calls": i % 4}
            for i in range(1, batch_size + 1)
        ]
        return {"raw_records": raw_records, "timestamp": time.time()}

    # 2. Validation & Cleaning
    def clean_and_validate(raw_records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Clean records and filter invalid values."""
        valid = [r for r in raw_records if r["monthly_spend"] > 0]
        return {"clean_records": valid, "record_count": len(valid)}

    # 3. Parallel Feature Branch A: Tenure features
    async def extract_tenure_features(clean_records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Extract tenure-based loyalty metrics."""
        await asyncio.sleep(0.08)
        tenure_scores = {r["id"]: round(r["tenure_months"] / 24.0, 2) for r in clean_records}
        return {"tenure_scores": tenure_scores}

    # 4. Parallel Feature Branch B: Spend & Support features
    async def extract_spend_features(clean_records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Extract risk indicators based on spend & complaints."""
        await asyncio.sleep(0.08)
        spend_scores = {r["id"]: round(r["monthly_spend"] * (r["support_calls"] + 1), 2) for r in clean_records}
        return {"spend_scores": spend_scores}

    # 5. Join Features & Churn Model Inference
    def score_churn_model(
        tenure_scores: Dict[str, float],
        spend_scores: Dict[str, float],
        clean_records: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Combine parallel feature branches and evaluate churn probability."""
        predictions = []
        for r in clean_records:
            cid = r["id"]
            t_score = tenure_scores.get(cid, 0.5)
            s_score = spend_scores.get(cid, 100.0)
            # Churn probability heuristic
            prob = round(min(0.99, max(0.01, (s_score / 400.0) - (t_score * 0.3))), 3)
            predictions.append({
                "customer_id": cid,
                "churn_risk": "HIGH" if prob > 0.6 else "LOW",
                "churn_probability": prob,
            })
        return {"predictions": predictions, "high_risk_count": sum(1 for p in predictions if p["churn_risk"] == "HIGH")}

    # 6. Alert & Notification Node
    def generate_alerts(predictions: List[Dict[str, Any]], high_risk_count: int) -> Dict[str, Any]:
        """Generate high-priority churn alerts for customer success."""
        alerts = [
            f"Alert: Customer {p['customer_id']} churn probability is {p['churn_probability'] * 100}%"
            for p in predictions if p["churn_risk"] == "HIGH"
        ]
        return {"alerts": alerts, "status": "DISPATCHED" if alerts else "NO_ALERTS"}

    # Register Nodes
    n_ingest = engine.add_node("ingest", ingest_data, name="Data Ingestion", cacheable=True)
    n_clean = engine.add_node("clean", clean_and_validate, name="Data Validation & Cleaning")
    n_tenure = engine.add_node("feat_tenure", extract_tenure_features, name="Extract Tenure Features")
    n_spend = engine.add_node("feat_spend", extract_spend_features, name="Extract Spend & Support Features")
    n_model = engine.add_node("ml_score", score_churn_model, name="Churn ML Model Inference")
    n_alert = engine.add_node("alerts", generate_alerts, name="Dispatch Alerts")

    # Wire up with DAG dependencies
    engine.add_edge("ingest", "clean")
    engine.add_edge("clean", "feat_tenure")
    engine.add_edge("clean", "feat_spend")
    engine.add_edge("clean", "ml_score")
    engine.add_edge("feat_tenure", "ml_score")
    engine.add_edge("feat_spend", "ml_score")
    engine.add_edge("ml_score", "alerts")

    return engine


if __name__ == "__main__":
    pipeline = build_data_pipeline()
    print("--- Topological Generations (Parallel Execution Layers) ---")
    for i, gen in enumerate(pipeline.get_parallel_generations()):
        print(f"Layer {i+1}: {gen}")

    print("\n--- Running GraphEngine ---")
    context = pipeline.run(initial_state={"batch_size": 4})
    print(f"Status: {context.status} in {context.total_duration_ms}ms")
    print("Execution Order:", context.execution_order)
    print("\nFinal Alerts Output:", context.get_output("alerts"))
