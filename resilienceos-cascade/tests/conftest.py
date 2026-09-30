"""Shared test fixtures and helper functions."""

import sys
from pathlib import Path

import pytest

# Ensure the app package is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.enums import AssetStatus, DependencyLogic
from app.models.schemas import (
    Asset,
    BackupSpec,
    CapacitySpec,
    Dependency,
    DependencyRequirement,
    FailureSpec,
    ScenarioInput,
)
from app.core.graph_builder import GraphBuilder


def make_asset(
    aid: str,
    atype: str = "power_station",
    name: str | None = None,
    criticality: float = 0.5,
    capacity_value: float | None = None,
    capacity_unit: str = "MW",
    load_value: float | None = None,
    population: int | None = None,
    backup_type: str | None = None,
    backup_capacity: float = 0,
    backup_minutes: float = 0,
    requirements: list | None = None,
) -> Asset:
    """Helper to create an Asset with minimal boilerplate."""
    cap = CapacitySpec(value=capacity_value, unit=capacity_unit) if capacity_value is not None else None
    load = CapacitySpec(value=load_value, unit=capacity_unit) if load_value is not None else None
    backup = (
        BackupSpec(type=backup_type, capacity=backup_capacity, fuel_minutes=backup_minutes)
        if backup_type else None
    )
    return Asset(
        asset_id=aid,
        asset_type=atype,
        name=name or aid,
        criticality=criticality,
        capacity=cap,
        current_load=load,
        population_served=population,
        backup=backup,
        requirements=requirements or [],
    )


def make_dep(
    did: str,
    src: str,
    tgt: str,
    dep_type: str = "electricity",
    req_cap: float = 0,
    cap_unit: str = "MW",
    strength: float = 1.0,
    critical: bool = True,
    threshold: float = 0.0,
) -> Dependency:
    """Helper to create a Dependency with minimal boilerplate."""
    return Dependency(
        dependency_id=did,
        source_asset=src,
        target_asset=tgt,
        dependency_type=dep_type,
        required_capacity=req_cap,
        capacity_unit=cap_unit,
        dependency_strength=strength,
        critical=critical,
        failure_threshold=threshold,
    )


def build_basic_graph():
    """Build the basic test network:

        SUBSTATION_A
         /   |   \\
        ↓    ↓    ↓
    HOSP  WATER  TELECOM
        ↓
    EMERGENCY
    """
    assets = [
        make_asset("SUBSTATION_A", "substation", criticality=0.85,
                    capacity_value=100, load_value=75),
        make_asset("HOSPITAL_01", "hospital", criticality=1.0,
                    capacity_value=500, load_value=420,
                    population=50000,
                    backup_type="generator", backup_capacity=30, backup_minutes=90,
                    requirements=[
                        DependencyRequirement(type="electricity", minimum_service=20, logic=DependencyLogic.OR),
                    ]),
        make_asset("WATER_PLANT_01", "water_plant", criticality=0.95,
                    capacity_value=200, load_value=150,
                    population=50000,
                    backup_type="storage", backup_capacity=1000, backup_minutes=35),
        make_asset("TELECOM_01", "telecom_tower", criticality=0.85,
                    capacity_value=10000, load_value=8500,
                    population=75000,
                    backup_type="battery", backup_capacity=5, backup_minutes=120),
        make_asset("EMERGENCY_01", "emergency_station", criticality=1.0,
                    capacity_value=50, load_value=35,
                    population=120000,
                    requirements=[
                        DependencyRequirement(type="electricity", minimum_service=15, logic=DependencyLogic.OR),
                        DependencyRequirement(type="telecommunications", minimum_service=1, logic=DependencyLogic.OR),
                    ]),
    ]

    deps = [
        make_dep("D1", "SUBSTATION_A", "HOSPITAL_01", req_cap=20),
        make_dep("D2", "SUBSTATION_A", "WATER_PLANT_01", req_cap=30),
        make_dep("D3", "SUBSTATION_A", "TELECOM_01", req_cap=10),
        make_dep("D4", "HOSPITAL_01", "EMERGENCY_01", dep_type="electricity", req_cap=15),
        make_dep("D5", "TELECOM_01", "EMERGENCY_01", dep_type="telecommunications", req_cap=1),
    ]

    builder = GraphBuilder()
    builder.build(assets, deps)
    return builder, assets, deps
