"""Pydantic schemas for the ResilienceOS Cascade Analyst.

Every input, output, and intermediate data structure is defined here with
full validation.  The Cascade Analyst is data-driven — new asset types and
dependency types can be added by providing new data without changing code.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.enums import (
    AssetStatus,
    CascadeAssetState,
    DependencyLogic,
    DependencyType,
    FailureMode,
    ImpactSeverity,
)


# ── Input schemas ────────────────────────────────────────────────────────


class CapacitySpec(BaseModel):
    """Capacity measurement for an asset."""
    value: float = Field(..., ge=0, description="Capacity value")
    unit: str = Field(..., description="Unit of measurement (MW, m³/h, …)")


class LocationSpec(BaseModel):
    """Geographic location of an asset."""
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)


class BackupSpec(BaseModel):
    """Backup / reserve specification for an asset."""
    type: str = Field(..., description="e.g. generator, battery, storage")
    capacity: float = Field(..., ge=0, description="Backup capacity")
    fuel_minutes: float = Field(..., ge=0, description="Duration in minutes at rated load")
    consumption_rate: Optional[float] = Field(
        None, ge=0,
        description="Units consumed per minute (if variable). "
                    "When None, fuel_minutes is used directly."
    )


class DependencyRequirement(BaseModel):
    """Minimum service requirement for a specific dependency type."""
    type: str = Field(..., description="Dependency type key (electricity, water, …)")
    minimum_service: float = Field(..., ge=0, description="Minimum capacity required")
    logic: DependencyLogic = Field(
        DependencyLogic.OR,
        description="How multiple sources combine: AND / OR / THRESHOLD",
    )


class Asset(BaseModel):
    """A single infrastructure asset."""
    asset_id: str = Field(..., min_length=1)
    asset_type: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    status: AssetStatus = AssetStatus.OPERATIONAL
    criticality: float = Field(..., ge=0, le=1)
    capacity: Optional[CapacitySpec] = None
    current_load: Optional[CapacitySpec] = None
    population_served: Optional[int] = Field(None, ge=0)
    location: Optional[LocationSpec] = None
    backup: Optional[BackupSpec] = None
    requirements: list[DependencyRequirement] = Field(
        default_factory=list,
        description="Minimum service requirements per dependency type",
    )
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("criticality")
    @classmethod
    def validate_criticality(cls, v: float) -> float:
        if not 0 <= v <= 1:
            raise ValueError("criticality must be in [0, 1]")
        return v


class Dependency(BaseModel):
    """A directed dependency between two assets."""
    dependency_id: str = Field(..., min_length=1)
    source_asset: str = Field(..., min_length=1)
    target_asset: str = Field(..., min_length=1)
    dependency_type: str = Field(..., min_length=1)
    required_capacity: float = Field(0, ge=0)
    capacity_unit: str = ""
    dependency_strength: float = Field(1.0, ge=0, le=1)
    critical: bool = True
    failure_threshold: float = Field(
        0.0, ge=0, le=1,
        description="Fraction of supply below which the dependency is considered failed",
    )


class AssetState(BaseModel):
    """Runtime state override for an asset."""
    asset_id: str
    status: AssetStatus
    capacity_available_percent: float = Field(100.0, ge=0, le=100)


# ── Scenario schemas ────────────────────────────────────────────────────


class FailureSpec(BaseModel):
    """Specification of a single asset failure."""
    asset_id: str
    mode: FailureMode = FailureMode.COMPLETE
    remaining_capacity_percent: float = Field(
        0.0, ge=0, le=100,
        description="Only used when mode is capacity_reduction or degraded",
    )


class ScenarioInput(BaseModel):
    """Input to the cascade simulation endpoint."""
    scenario_id: Optional[str] = None
    root_failures: list[FailureSpec] = Field(..., min_length=1)
    simulation_time_minutes: float = Field(
        480, ge=0,
        description="How far into the future to simulate (default 8 hours)",
    )


# ── Graph build schemas ─────────────────────────────────────────────────


class GraphBuildRequest(BaseModel):
    """Request to build the infrastructure graph from raw data."""
    assets: list[Asset]
    dependencies: list[Dependency]
    states: list[AssetState] = Field(default_factory=list)


class GraphValidationWarning(BaseModel):
    """A non-fatal validation finding."""
    code: str
    message: str
    related_ids: list[str] = Field(default_factory=list)


class GraphBuildResponse(BaseModel):
    """Response after building and validating the graph."""
    node_count: int
    edge_count: int
    warnings: list[GraphValidationWarning] = Field(default_factory=list)
    cycles_detected: list[list[str]] = Field(default_factory=list)
    isolated_assets: list[str] = Field(default_factory=list)


# ── Cascade result schemas ──────────────────────────────────────────────


class AlternativeSupply(BaseModel):
    """An alternative supplier that *could* serve a target asset."""
    source_asset_id: str
    dependency_type: str
    available_capacity: float
    required_capacity: float
    feasible: bool
    capacity_unit: str = ""


class AffectedAsset(BaseModel):
    """Result for one asset affected by the cascade."""
    asset_id: str
    name: str = ""
    asset_type: str = ""
    state: CascadeAssetState
    previous_state: CascadeAssetState = CascadeAssetState.OPERATIONAL
    impact_score: float = Field(0.0, ge=0, le=1)
    impact_severity: ImpactSeverity = ImpactSeverity.LOW
    runway_minutes: Optional[float] = None
    criticality: float = Field(0.0, ge=0, le=1)
    cascade_depth: int = Field(0, ge=0)
    capacity_available_percent: float = Field(100.0, ge=0, le=100)
    population_affected: Optional[int] = None
    paths: list[list[str]] = Field(default_factory=list)
    alternative_supplies: list[AlternativeSupply] = Field(default_factory=list)
    dependency_satisfaction: dict[str, float] = Field(
        default_factory=dict,
        description="Per dependency-type → fraction of requirement met [0-1]",
    )
    backup_active: bool = False


class TimelineEvent(BaseModel):
    """A single event in the cascade timeline."""
    time_minutes: float
    asset_id: str
    event: str
    details: str = ""


class CascadeSummary(BaseModel):
    """High-level summary of the cascade result."""
    assets_affected: int = 0
    assets_failed: int = 0
    assets_at_risk: int = 0
    assets_protected: int = 0
    assets_degraded: int = 0
    cascade_depth: int = 0
    failure_r0: float = 0.0
    critical_services_at_risk: int = 0
    population_affected: Optional[int] = None


class CascadeResult(BaseModel):
    """Complete result of a cascade simulation."""
    scenario_id: str
    root_failures: list[str]
    analysis_timestamp: datetime
    summary: CascadeSummary
    affected_assets: list[AffectedAsset] = Field(default_factory=list)
    timeline: list[TimelineEvent] = Field(default_factory=list)
    graph_snapshot: Optional[dict[str, Any]] = None


# ── Graph inspection schemas ─────────────────────────────────────────────


class GraphNodeInfo(BaseModel):
    """Info about a single graph node (asset)."""
    asset_id: str
    asset_type: str
    name: str
    criticality: float
    status: str
    in_degree: int = 0
    out_degree: int = 0
    capacity: Optional[CapacitySpec] = None
    current_load: Optional[CapacitySpec] = None


class GraphEdgeInfo(BaseModel):
    """Info about a single graph edge (dependency)."""
    dependency_id: str
    source: str
    target: str
    dependency_type: str
    required_capacity: float = 0
    dependency_strength: float = 1.0
    critical: bool = True


class GraphInfo(BaseModel):
    """Full graph inspection response."""
    node_count: int
    edge_count: int
    nodes: list[GraphNodeInfo]
    edges: list[GraphEdgeInfo]
    warnings: list[GraphValidationWarning] = Field(default_factory=list)


# ── Error schemas ────────────────────────────────────────────────────────


class ErrorDetail(BaseModel):
    """Structured API error."""
    code: str
    message: str


class ErrorResponse(BaseModel):
    """Top-level error envelope."""
    error: ErrorDetail
