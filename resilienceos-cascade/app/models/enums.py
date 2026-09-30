"""Enumeration types for the ResilienceOS Cascade Analyst."""

from enum import Enum


class AssetStatus(str, Enum):
    """Operational status of an infrastructure asset."""
    OPERATIONAL = "OPERATIONAL"
    DEGRADED = "DEGRADED"
    FAILED = "FAILED"
    RECOVERING = "RECOVERING"
    UNKNOWN = "UNKNOWN"


class CascadeAssetState(str, Enum):
    """State of an asset during/after cascade analysis.
    
    Extends AssetStatus with cascade-specific states that distinguish
    between assets that have failed vs. those that are protected or at risk.
    """
    OPERATIONAL = "OPERATIONAL"
    PROTECTED = "PROTECTED"       # Has backup or redundant supply
    AT_RISK = "AT_RISK"           # Backup is finite / supply marginal
    DEGRADED = "DEGRADED"         # Partial capacity loss
    FAILED = "FAILED"             # Cannot function
    UNKNOWN = "UNKNOWN"


class FailureMode(str, Enum):
    """How an asset fails in a scenario."""
    COMPLETE = "complete"
    CAPACITY_REDUCTION = "capacity_reduction"
    DEGRADED = "degraded"


class DependencyType(str, Enum):
    """Types of infrastructure dependencies."""
    ELECTRICITY = "electricity"
    WATER = "water"
    TELECOMMUNICATIONS = "telecommunications"
    TRANSPORT = "transport"
    FUEL = "fuel"
    COOLING = "cooling"
    DATA = "data"


class DependencyLogic(str, Enum):
    """How multiple dependencies of the same type combine."""
    AND = "AND"   # All sources required
    OR = "OR"     # Any one source sufficient
    THRESHOLD = "THRESHOLD"  # Minimum capacity required


class ImpactSeverity(str, Enum):
    """Classified impact severity."""
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class ValidationErrorCode(str, Enum):
    """Error codes for graph and input validation."""
    ASSET_NOT_FOUND = "ASSET_NOT_FOUND"
    INVALID_DEPENDENCY = "INVALID_DEPENDENCY"
    INVALID_CAPACITY = "INVALID_CAPACITY"
    INVALID_CRITICALITY = "INVALID_CRITICALITY"
    GRAPH_VALIDATION_FAILED = "GRAPH_VALIDATION_FAILED"
    INVALID_FAILURE_MODE = "INVALID_FAILURE_MODE"
    MISSING_REQUIRED_STATE = "MISSING_REQUIRED_STATE"
    DUPLICATE_DEPENDENCY_ID = "DUPLICATE_DEPENDENCY_ID"
    INVALID_DEPENDENCY_TYPE = "INVALID_DEPENDENCY_TYPE"
    ISOLATED_ASSET = "ISOLATED_ASSET"
    CYCLE_DETECTED = "CYCLE_DETECTED"
