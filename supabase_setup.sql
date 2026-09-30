-- Supabase Setup Script for ResilienceOS Telemetry Data

-- 1. Substation Telemetry Table
CREATE TABLE telemetry_substation (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    node_id TEXT NOT NULL,
    load_kw FLOAT,
    capacity_kw INT,
    load_ratio FLOAT,
    voltage FLOAT,
    voltage_deviation FLOAT,
    frequency_hz FLOAT,
    temperature FLOAT,
    temperature_trend FLOAT,
    vibration FLOAT,
    humidity FLOAT,
    oil_level FLOAT,
    transformer_age_years INT,
    backup_fuel_pct FLOAT,
    population_served INT,
    health_status TEXT,
    failure_label INT
);

-- 2. Road Telemetry Table
CREATE TABLE telemetry_road (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    node_id TEXT NOT NULL,
    traffic_flow_pct FLOAT,
    capacity_vehicles_hr INT,
    current_vehicles_hr INT,
    load_ratio FLOAT,
    avg_speed_kmh FLOAT,
    speed_deviation FLOAT,
    incident_count INT,
    road_surface_score FLOAT,
    visibility_km FLOAT,
    rainfall_mm FLOAT,
    flood_depth_cm FLOAT,
    debris_coverage_pct FLOAT,
    crew_access_blocked BOOLEAN,
    detour_available BOOLEAN,
    population_served INT,
    health_status TEXT,
    failure_label INT
);

-- 3. Water Plant Telemetry Table
CREATE TABLE telemetry_water_plant (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    node_id TEXT NOT NULL,
    flow_rate_lps FLOAT,
    capacity_lps INT,
    load_ratio FLOAT,
    pressure_bar FLOAT,
    pressure_deviation FLOAT,
    chlorine_ppm FLOAT,
    turbidity_ntu FLOAT,
    ph_level FLOAT,
    pump_temperature FLOAT,
    pump_vibration FLOAT,
    power_supply_kw FLOAT,
    reservoir_level_pct FLOAT,
    pipeline_age_years INT,
    population_served INT,
    health_status TEXT,
    failure_label INT
);

-- Indexes for performance
CREATE INDEX idx_substation_timestamp ON telemetry_substation (timestamp);
CREATE INDEX idx_substation_node_id ON telemetry_substation (node_id);

CREATE INDEX idx_road_timestamp ON telemetry_road (timestamp);
CREATE INDEX idx_road_node_id ON telemetry_road (node_id);

CREATE INDEX idx_water_timestamp ON telemetry_water_plant (timestamp);
CREATE INDEX idx_water_node_id ON telemetry_water_plant (node_id);
