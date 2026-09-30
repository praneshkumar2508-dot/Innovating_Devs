"""
Example: Conditional Branching Pipeline.
Demonstrates routing workflows dynamically where downstream execution branches
based on runtime predicates or decisions.
"""

from typing import Any, Dict
from graphengine import GraphEngine


def build_branch_pipeline() -> GraphEngine:
    engine = GraphEngine(
        graph_id="loan_approval_workflow",
        name="Loan Approval & Risk Routing DAG",
        description="Evaluates applicant risk score and branches to instant approval or fraud investigation.",
    )

    # 1. Applicant Intake
    def intake_application(applicant_id: str = "app_901", credit_score: int = 740, loan_amount: float = 25000.0) -> Dict[str, Any]:
        return {
            "applicant_id": applicant_id,
            "credit_score": credit_score,
            "loan_amount": loan_amount,
        }

    # 2. Risk Assessment
    def assess_risk(credit_score: int, loan_amount: float) -> Dict[str, Any]:
        # Risk index: lower credit score or higher amount increases risk
        risk_score = round(max(0, (850 - credit_score) * 0.4 + (loan_amount / 2000.0)), 1)
        is_high_risk = risk_score > 60.0
        return {
            "risk_score": risk_score,
            "is_high_risk": is_high_risk,
            "route": "AUDIT" if is_high_risk else "AUTO_APPROVE",
        }

    # 3. Branch A: Instant Approval
    def instant_approval(applicant_id: str, loan_amount: float, risk_score: float) -> Dict[str, Any]:
        return {
            "decision": "APPROVED",
            "applicant_id": applicant_id,
            "amount_funded": loan_amount,
            "interest_rate": 5.4,
            "notes": f"Auto-approved with low risk score of {risk_score}.",
        }

    # 4. Branch B: Fraud Audit & Manual Review
    def fraud_audit(applicant_id: str, loan_amount: float, risk_score: float) -> Dict[str, Any]:
        return {
            "decision": "FLAGGED_FOR_AUDIT",
            "applicant_id": applicant_id,
            "amount_requested": loan_amount,
            "risk_score": risk_score,
            "audit_queue": "tier_2_risk_analysts",
            "notes": "Requires employment verification and manual underwriter sign-off.",
        }

    # 5. Final Dispatch & Archival
    def notify_and_archive(decision: str = "PENDING", applicant_id: str = "") -> Dict[str, Any]:
        return {
            "applicant_id": applicant_id,
            "final_status": decision,
            "email_sent": True,
            "audit_trail_saved": True,
        }

    # Register Nodes
    engine.add_node("intake", intake_application, name="Intake Application")
    engine.add_node("risk", assess_risk, name="Risk Assessment Engine")
    engine.add_node("approve", instant_approval, name="Instant Auto-Approval")
    engine.add_node("audit", fraud_audit, name="Fraud & Underwriter Audit")
    engine.add_node("notify", notify_and_archive, name="Notification & Archival")

    # Wire up edges with conditions
    engine.add_edge("intake", "risk")

    # Conditional Branch A: only if route == 'AUTO_APPROVE'
    engine.add_edge(
        "risk",
        "approve",
        condition=lambda out: out.get("route") == "AUTO_APPROVE",
        label="risk <= 60 (Low)",
    )

    # Conditional Branch B: only if route == 'AUDIT'
    engine.add_edge(
        "risk",
        "audit",
        condition=lambda out: out.get("route") == "AUDIT",
        label="risk > 60 (High)",
    )

    # Both lead to notify
    engine.add_edge("approve", "notify")
    engine.add_edge("audit", "notify")

    return engine


if __name__ == "__main__":
    pipeline = build_branch_pipeline()

    print("--- Test Run 1: High Credit Score (Auto-Approve) ---")
    ctx1 = pipeline.run({"applicant_id": "cust_alice", "credit_score": 790, "loan_amount": 15000.0})
    print("Status:", ctx1.status)
    print("Executed Nodes:", ctx1.execution_order)
    print("Node Results Statuses:", {k: v.status.value for k, v in ctx1.node_results.items()})
    print("Approval Result:", ctx1.get_output("approve"))

    print("\n--- Test Run 2: Low Credit Score (Fraud Audit) ---")
    ctx2 = pipeline.run({"applicant_id": "cust_bob", "credit_score": 520, "loan_amount": 60000.0})
    print("Status:", ctx2.status)
    print("Executed Nodes:", ctx2.execution_order)
    print("Node Results Statuses:", {k: v.status.value for k, v in ctx2.node_results.items()})
    print("Audit Result:", ctx2.get_output("audit"))
