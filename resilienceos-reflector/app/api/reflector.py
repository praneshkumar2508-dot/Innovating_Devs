from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from pydantic import BaseModel
import datetime
import uuid

router = APIRouter()

class ReflectionSummary(BaseModel):
    prediction_result: str
    cascade_result: str
    runway_result: str
    recovery_result: str
    challenger_result: str

class Deviation(BaseModel):
    type: str
    node: str
    expected: float
    observed: float
    difference: float
    severity: str

class RootCause(BaseModel):
    cause: str
    confidence: float
    evidence: List[str]

class Lesson(BaseModel):
    lesson_id: str
    category: str
    title: str
    confidence: float

class Recommendation(BaseModel):
    parameter: str
    status: str

class ReflectionResult(BaseModel):
    reflection_id: str
    incident_id: str
    status: str
    summary: ReflectionSummary
    deviations: List[Deviation]
    root_causes: List[RootCause]
    lessons: List[Lesson]
    regression_tests_created: List[str]
    patterns: List[str]
    recommendations: List[Recommendation]

# Mock database
reflections_db = {}

@router.post("/analyze", response_model=ReflectionResult)
def analyze_incident(incident_data: Dict[str, Any]):
    incident_id = incident_data.get("incident_id", f"INC-{uuid.uuid4().hex[:6].upper()}")
    
    # Generate deterministic MVP reflection based on input incident data
    # (In a full implementation, this calls timeline_engine, deviation_detector, etc.)
    result = ReflectionResult(
        reflection_id=f"REF-{datetime.datetime.now().year}-{uuid.uuid4().hex[:4].upper()}",
        incident_id=incident_id,
        status="COMPLETED",
        summary=ReflectionSummary(
            prediction_result="TRUE_POSITIVE",
            cascade_result="OVER_PREDICTED",
            runway_result="UNDER_ESTIMATED",
            recovery_result="DELAYED",
            challenger_result="COVERED"
        ),
        deviations=[
            Deviation(
                type="RUNWAY_ESTIMATION_ERROR",
                node="HOSP01",
                expected=35,
                observed=29,
                difference=-6,
                severity="HIGH"
            )
        ],
        root_causes=[
            RootCause(
                cause="CREW_DELAY",
                confidence=0.91,
                evidence=["EVENT-012"]
            )
        ],
        lessons=[
            Lesson(
                lesson_id=f"LESSON-{uuid.uuid4().hex[:4].upper()}",
                category="RUNWAY_LESSON",
                title="Hospital runway was overestimated",
                confidence=0.88
            )
        ],
        regression_tests_created=["REG-001", "REG-002"],
        patterns=[],
        recommendations=[
            Recommendation(
                parameter="HOSP01.runway_safety_margin",
                status="PENDING_REVIEW"
            )
        ]
    )
    
    reflections_db[incident_id] = result
    return result

@router.get("/{incident_id}", response_model=ReflectionResult)
def get_reflection(incident_id: str):
    if incident_id not in reflections_db:
        raise HTTPException(status_code=404, detail="Reflection not found")
    return reflections_db[incident_id]
