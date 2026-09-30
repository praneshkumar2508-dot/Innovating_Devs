"""
ResilienceOS — Dataset Generator
Generates 15 CSV datasets (5 per node type) for the Predictive Analyst.
Each dataset has 100+ rows of realistic telemetry data.
"""
import csv
import os
import random
import math
from datetime import datetime, timedelta

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "datasets")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ============================================================
# SUBSTATION DATASETS (PWR_SUB_A)
# ============================================================
def gen_substation_dataset(scenario_num, scenario_name, rows=120):
    filename = f"substation_scenario_{scenario_num}_{scenario_name}.csv"
    filepath = os.path.join(OUTPUT_DIR, filename)
    
    fieldnames = [
        "timestamp", "node_id", "load_kw", "capacity_kw", "load_ratio",
        "voltage", "voltage_deviation", "frequency_hz", "temperature",
        "temperature_trend", "vibration", "humidity", "oil_level",
        "transformer_age_years", "backup_fuel_pct", "population_served",
        "health_status", "failure_label"
    ]
    
    base_time = datetime(2026, 9, 30, 0, 0, 0)
    
    with open(filepath, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        
        for i in range(rows):
            t = base_time + timedelta(minutes=i * 5)
            progress = i / rows  # 0.0 to 1.0
            
            if scenario_name == "normal_ops":
                load = 65 + random.uniform(-5, 8)
                voltage = 230 + random.uniform(-3, 3)
                temp = 52 + random.uniform(-2, 4)
                vibration = 0.1 + random.uniform(0, 0.05)
                health = "HEALTHY"
                fail = 0
                
            elif scenario_name == "gradual_overload":
                load = 65 + progress * 45 + random.uniform(-3, 3)
                voltage = 230 - progress * 25 + random.uniform(-2, 2)
                temp = 52 + progress * 35 + random.uniform(-1, 3)
                vibration = 0.1 + progress * 0.8 + random.uniform(0, 0.1)
                health = "HEALTHY" if progress < 0.5 else ("STRESSED" if progress < 0.8 else "FAILED")
                fail = 1 if progress > 0.85 else 0
                
            elif scenario_name == "sudden_spike":
                spike_point = 0.6
                if progress < spike_point:
                    load = 70 + random.uniform(-5, 5)
                    voltage = 228 + random.uniform(-3, 3)
                    temp = 54 + random.uniform(-2, 3)
                    vibration = 0.12 + random.uniform(0, 0.05)
                    health = "HEALTHY"
                    fail = 0
                else:
                    spike_intensity = (progress - spike_point) / (1 - spike_point)
                    load = 70 + spike_intensity * 50 + random.uniform(-2, 5)
                    voltage = 228 - spike_intensity * 40 + random.uniform(-5, 2)
                    temp = 54 + spike_intensity * 45 + random.uniform(-1, 5)
                    vibration = 0.12 + spike_intensity * 1.2 + random.uniform(0, 0.15)
                    health = "STRESSED" if spike_intensity < 0.5 else "FAILED"
                    fail = 1 if spike_intensity > 0.6 else 0
                    
            elif scenario_name == "weather_stress":
                # Cyclone approaching — humidity rises, temperature oscillates
                load = 75 + progress * 20 + 10 * math.sin(progress * 8) + random.uniform(-3, 3)
                voltage = 225 - progress * 15 + 5 * math.sin(progress * 6) + random.uniform(-4, 2)
                temp = 58 + progress * 20 + 8 * math.sin(progress * 10) + random.uniform(-2, 4)
                vibration = 0.15 + progress * 0.4 + 0.1 * math.sin(progress * 12) + random.uniform(0, 0.08)
                health = "HEALTHY" if progress < 0.4 else ("STRESSED" if progress < 0.75 else "AT_RISK")
                fail = 1 if progress > 0.9 else 0
                
            elif scenario_name == "cascading_failure":
                # Upstream failure at t=40%, causes slow degradation
                if progress < 0.4:
                    load = 68 + random.uniform(-4, 6)
                    voltage = 229 + random.uniform(-2, 2)
                    temp = 53 + random.uniform(-2, 3)
                    vibration = 0.11 + random.uniform(0, 0.04)
                    health = "HEALTHY"
                    fail = 0
                else:
                    decay = (progress - 0.4) / 0.6
                    load = 68 + decay * 55 + random.uniform(-3, 5)
                    voltage = 229 - decay * 50 + random.uniform(-5, 2)
                    temp = 53 + decay * 40 + random.uniform(-2, 6)
                    vibration = 0.11 + decay * 1.5 + random.uniform(0, 0.2)
                    health = "STRESSED" if decay < 0.3 else ("AT_RISK" if decay < 0.6 else "FAILED")
                    fail = 1 if decay > 0.7 else 0
            
            load_ratio = load / 100.0
            voltage_dev = abs(voltage - 230) / 230.0
            temp_trend = 0 if i == 0 else (temp - (52 + random.uniform(-1, 1))) / 10.0
            humidity = 60 + progress * 15 + random.uniform(-5, 5) if scenario_name == "weather_stress" else 45 + random.uniform(-5, 10)
            oil = max(20, 95 - progress * 30 + random.uniform(-5, 5)) if scenario_name != "normal_ops" else 90 + random.uniform(-3, 3)
            fuel = max(5, 80 - progress * 60 + random.uniform(-5, 5)) if scenario_name in ("cascading_failure", "gradual_overload") else 85 + random.uniform(-5, 5)
            
            writer.writerow({
                "timestamp": t.isoformat(),
                "node_id": "PWR_SUB_A",
                "load_kw": round(max(0, load), 2),
                "capacity_kw": 100,
                "load_ratio": round(max(0, load_ratio), 4),
                "voltage": round(max(150, voltage), 2),
                "voltage_deviation": round(max(0, voltage_dev), 4),
                "frequency_hz": round(50 + random.uniform(-0.3, 0.3), 2),
                "temperature": round(max(20, temp), 2),
                "temperature_trend": round(temp_trend, 4),
                "vibration": round(max(0, vibration), 4),
                "humidity": round(max(20, min(100, humidity)), 2),
                "oil_level": round(max(10, min(100, oil)), 2),
                "transformer_age_years": 12,
                "backup_fuel_pct": round(max(0, min(100, fuel)), 2),
                "population_served": 180000,
                "health_status": health,
                "failure_label": fail
            })
    print(f"  ✓ Generated {filepath} ({rows} rows)")

# ============================================================
# ROAD DATASETS (TRN_ROAD_R1)
# ============================================================
def gen_road_dataset(scenario_num, scenario_name, rows=120):
    filename = f"road_scenario_{scenario_num}_{scenario_name}.csv"
    filepath = os.path.join(OUTPUT_DIR, filename)
    
    fieldnames = [
        "timestamp", "node_id", "traffic_flow_pct", "capacity_vehicles_hr",
        "current_vehicles_hr", "load_ratio", "avg_speed_kmh", "speed_deviation",
        "incident_count", "road_surface_score", "visibility_km",
        "rainfall_mm", "flood_depth_cm", "debris_coverage_pct",
        "crew_access_blocked", "detour_available", "population_served",
        "health_status", "failure_label"
    ]
    
    base_time = datetime(2026, 9, 30, 0, 0, 0)
    
    with open(filepath, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        
        for i in range(rows):
            t = base_time + timedelta(minutes=i * 5)
            progress = i / rows
            
            if scenario_name == "normal_traffic":
                traffic = 60 + 15 * math.sin(progress * 4 * math.pi) + random.uniform(-5, 5)
                speed = 55 + random.uniform(-8, 8)
                incidents = 0 if random.random() > 0.05 else 1
                surface = 85 + random.uniform(-5, 5)
                visibility = 8 + random.uniform(-1, 2)
                rain = random.uniform(0, 2)
                flood = 0
                debris = 0
                blocked = 0
                health = "HEALTHY"
                fail = 0
                
            elif scenario_name == "flood_blockage":
                if progress < 0.3:
                    traffic = 65 + random.uniform(-5, 5)
                    speed = 50 + random.uniform(-5, 5)
                    rain = 5 + progress * 30 + random.uniform(-2, 5)
                    flood = 0
                    debris = 0
                    blocked = 0
                    health = "HEALTHY"
                    fail = 0
                elif progress < 0.6:
                    phase = (progress - 0.3) / 0.3
                    traffic = 65 - phase * 40 + random.uniform(-5, 5)
                    speed = 50 - phase * 35 + random.uniform(-5, 3)
                    rain = 35 + phase * 20 + random.uniform(-3, 8)
                    flood = phase * 45 + random.uniform(-2, 5)
                    debris = phase * 15 + random.uniform(-2, 5)
                    blocked = 1 if phase > 0.5 else 0
                    health = "STRESSED" if phase < 0.5 else "AT_RISK"
                    fail = 0
                else:
                    traffic = max(0, 15 - (progress - 0.6) * 20 + random.uniform(-5, 5))
                    speed = max(0, 10 + random.uniform(-5, 5))
                    rain = 55 - (progress - 0.6) * 30 + random.uniform(-5, 5)
                    flood = 45 + (progress - 0.6) * 20 + random.uniform(-3, 8)
                    debris = 30 + random.uniform(-5, 10)
                    blocked = 1
                    health = "FAILED"
                    fail = 1
                incidents = 1 if random.random() > 0.6 else 0
                surface = max(20, 85 - progress * 50 + random.uniform(-5, 5))
                visibility = max(0.5, 8 - progress * 7 + random.uniform(-1, 1))
                
            elif scenario_name == "debris_accident":
                crash_point = 0.45
                if progress < crash_point:
                    traffic = 70 + random.uniform(-8, 8)
                    speed = 60 + random.uniform(-5, 5)
                    incidents = 0
                    debris = random.uniform(0, 2)
                    blocked = 0
                    health = "HEALTHY"
                    fail = 0
                else:
                    decay = (progress - crash_point) / (1 - crash_point)
                    traffic = max(5, 70 - decay * 60 + random.uniform(-5, 5))
                    speed = max(0, 60 - decay * 55 + random.uniform(-3, 3))
                    incidents = 1 + (1 if random.random() > 0.7 else 0)
                    debris = decay * 65 + random.uniform(-5, 10)
                    blocked = 1 if decay > 0.3 else 0
                    health = "STRESSED" if decay < 0.3 else ("AT_RISK" if decay < 0.6 else "FAILED")
                    fail = 1 if decay > 0.6 else 0
                rain = random.uniform(0, 3)
                flood = 0
                surface = max(30, 85 - max(0, (progress - crash_point)) * 60 + random.uniform(-3, 5))
                visibility = max(2, 8 - max(0, (progress - crash_point)) * 5 + random.uniform(-1, 1))
                
            elif scenario_name == "construction_lane_closure":
                traffic = 80 + random.uniform(-5, 5)
                speed = max(10, 40 - progress * 25 + random.uniform(-5, 5))
                incidents = 1 if random.random() > 0.85 else 0
                surface = 60 + random.uniform(-10, 10)
                visibility = 6 + random.uniform(-1, 2)
                rain = random.uniform(0, 5)
                flood = 0
                debris = 10 + progress * 20 + random.uniform(-3, 5)
                blocked = 1 if progress > 0.7 else 0
                health = "HEALTHY" if progress < 0.3 else ("STRESSED" if progress < 0.6 else "AT_RISK")
                fail = 1 if progress > 0.85 else 0
                
            elif scenario_name == "peak_hour_gridlock":
                # Rush-hour pattern with double peaks
                peak1 = math.exp(-((progress - 0.3) ** 2) / 0.01)
                peak2 = math.exp(-((progress - 0.7) ** 2) / 0.01)
                congestion = 0.4 + 0.6 * max(peak1, peak2)
                traffic = 95 * congestion + random.uniform(-5, 5)
                speed = max(5, 60 * (1 - congestion) + random.uniform(-5, 5))
                incidents = 1 if congestion > 0.8 and random.random() > 0.5 else 0
                surface = 80 + random.uniform(-5, 5)
                visibility = 7 + random.uniform(-1, 2)
                rain = random.uniform(0, 3)
                flood = 0
                debris = congestion * 10 + random.uniform(-2, 3)
                blocked = 1 if congestion > 0.9 else 0
                health = "HEALTHY" if congestion < 0.6 else ("STRESSED" if congestion < 0.85 else "AT_RISK")
                fail = 0
            
            writer.writerow({
                "timestamp": t.isoformat(),
                "node_id": "TRN_ROAD_R1",
                "traffic_flow_pct": round(max(0, min(100, traffic)), 2),
                "capacity_vehicles_hr": 2000,
                "current_vehicles_hr": round(max(0, traffic / 100 * 2000), 0),
                "load_ratio": round(max(0, traffic / 100), 4),
                "avg_speed_kmh": round(max(0, speed), 2),
                "speed_deviation": round(abs(speed - 55) / 55, 4),
                "incident_count": incidents,
                "road_surface_score": round(max(0, min(100, surface)), 2),
                "visibility_km": round(max(0.1, visibility), 2),
                "rainfall_mm": round(max(0, rain), 2),
                "flood_depth_cm": round(max(0, flood), 2),
                "debris_coverage_pct": round(max(0, min(100, debris)), 2),
                "crew_access_blocked": blocked,
                "detour_available": 1 if random.random() > 0.3 else 0,
                "population_served": 150000,
                "health_status": health,
                "failure_label": fail
            })
    print(f"  ✓ Generated {filepath} ({rows} rows)")

# ============================================================
# WATER PLANT DATASETS (WTR_PLANT_A)
# ============================================================
def gen_water_dataset(scenario_num, scenario_name, rows=120):
    filename = f"water_plant_scenario_{scenario_num}_{scenario_name}.csv"
    filepath = os.path.join(OUTPUT_DIR, filename)
    
    fieldnames = [
        "timestamp", "node_id", "flow_rate_lps", "capacity_lps",
        "load_ratio", "pressure_bar", "pressure_deviation",
        "chlorine_ppm", "turbidity_ntu", "ph_level",
        "pump_temperature", "pump_vibration", "power_supply_kw",
        "reservoir_level_pct", "pipeline_age_years",
        "population_served", "health_status", "failure_label"
    ]
    
    base_time = datetime(2026, 9, 30, 0, 0, 0)
    
    with open(filepath, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        
        for i in range(rows):
            t = base_time + timedelta(minutes=i * 5)
            progress = i / rows
            
            if scenario_name == "normal_supply":
                flow = 68 + 10 * math.sin(progress * 4 * math.pi) + random.uniform(-3, 3)
                pressure = 4.5 + random.uniform(-0.3, 0.3)
                chlorine = 1.2 + random.uniform(-0.1, 0.1)
                turbidity = 0.8 + random.uniform(-0.2, 0.3)
                ph = 7.2 + random.uniform(-0.2, 0.2)
                pump_temp = 42 + random.uniform(-3, 4)
                pump_vib = 0.08 + random.uniform(0, 0.03)
                power = 45 + random.uniform(-3, 3)
                reservoir = 82 + random.uniform(-5, 5)
                health = "HEALTHY"
                fail = 0
                
            elif scenario_name == "pump_degradation":
                flow = max(10, 68 - progress * 50 + random.uniform(-3, 5))
                pressure = max(1.0, 4.5 - progress * 3.0 + random.uniform(-0.2, 0.2))
                chlorine = 1.2 - progress * 0.4 + random.uniform(-0.05, 0.05)
                turbidity = 0.8 + progress * 4.0 + random.uniform(-0.3, 0.5)
                ph = 7.2 + progress * 0.8 + random.uniform(-0.1, 0.1)
                pump_temp = 42 + progress * 35 + random.uniform(-2, 5)
                pump_vib = 0.08 + progress * 1.2 + random.uniform(0, 0.15)
                power = 45 + progress * 20 + random.uniform(-3, 5)
                reservoir = max(10, 82 - progress * 60 + random.uniform(-3, 5))
                health = "HEALTHY" if progress < 0.35 else ("STRESSED" if progress < 0.65 else ("AT_RISK" if progress < 0.85 else "FAILED"))
                fail = 1 if progress > 0.85 else 0
                
            elif scenario_name == "contamination_event":
                contam_start = 0.35
                if progress < contam_start:
                    flow = 70 + random.uniform(-3, 3)
                    pressure = 4.5 + random.uniform(-0.2, 0.2)
                    chlorine = 1.2 + random.uniform(-0.1, 0.1)
                    turbidity = 0.8 + random.uniform(-0.1, 0.2)
                    ph = 7.2 + random.uniform(-0.1, 0.1)
                    pump_temp = 43 + random.uniform(-2, 3)
                    pump_vib = 0.09 + random.uniform(0, 0.03)
                    power = 45 + random.uniform(-2, 2)
                    reservoir = 80 + random.uniform(-3, 3)
                    health = "HEALTHY"
                    fail = 0
                else:
                    phase = (progress - contam_start) / (1 - contam_start)
                    flow = 70 - phase * 30 + random.uniform(-5, 5)
                    pressure = 4.5 - phase * 1.5 + random.uniform(-0.3, 0.2)
                    chlorine = max(0.1, 1.2 - phase * 1.0 + random.uniform(-0.1, 0.05))
                    turbidity = 0.8 + phase * 8.0 + random.uniform(-0.5, 1.0)
                    ph = 7.2 + phase * 2.0 + random.uniform(-0.2, 0.3)
                    pump_temp = 43 + phase * 15 + random.uniform(-2, 4)
                    pump_vib = 0.09 + phase * 0.5 + random.uniform(0, 0.08)
                    power = 45 + phase * 10 + random.uniform(-2, 3)
                    reservoir = max(15, 80 - phase * 50 + random.uniform(-5, 5))
                    health = "STRESSED" if phase < 0.4 else ("AT_RISK" if phase < 0.7 else "FAILED")
                    fail = 1 if phase > 0.75 else 0
                    
            elif scenario_name == "power_loss_impact":
                # Power cut at 50% causes pump failure
                cut_point = 0.5
                if progress < cut_point:
                    flow = 70 + random.uniform(-3, 3)
                    pressure = 4.5 + random.uniform(-0.2, 0.2)
                    chlorine = 1.2 + random.uniform(-0.05, 0.05)
                    turbidity = 0.9 + random.uniform(-0.1, 0.2)
                    ph = 7.2 + random.uniform(-0.1, 0.1)
                    pump_temp = 43 + random.uniform(-2, 3)
                    pump_vib = 0.09 + random.uniform(0, 0.03)
                    power = 45 + random.uniform(-2, 2)
                    reservoir = 78 + random.uniform(-3, 3)
                    health = "HEALTHY"
                    fail = 0
                else:
                    decay = (progress - cut_point) / (1 - cut_point)
                    power = max(0, 45 * (1 - decay * 1.5) + random.uniform(-2, 2))
                    flow = max(0, 70 * (1 - decay * 0.9) + random.uniform(-5, 3))
                    pressure = max(0.5, 4.5 * (1 - decay * 0.8) + random.uniform(-0.3, 0.1))
                    chlorine = max(0.2, 1.2 - decay * 0.6 + random.uniform(-0.05, 0.05))
                    turbidity = 0.9 + decay * 3.0 + random.uniform(-0.3, 0.5)
                    ph = 7.2 + decay * 0.5 + random.uniform(-0.1, 0.15)
                    pump_temp = 43 + decay * 25 + random.uniform(-3, 5)
                    pump_vib = 0.09 + decay * 0.8 + random.uniform(0, 0.1)
                    reservoir = max(5, 78 - decay * 65 + random.uniform(-5, 5))
                    health = "STRESSED" if decay < 0.3 else ("AT_RISK" if decay < 0.6 else "FAILED")
                    fail = 1 if decay > 0.65 else 0
                    
            elif scenario_name == "demand_surge":
                # Festival/drought causes massive demand
                surge = 0.3 + 0.7 * (0.5 + 0.5 * math.sin(progress * 3 * math.pi))
                flow = 68 + surge * 40 + random.uniform(-5, 5)
                pressure = max(1.5, 4.5 - surge * 2.5 + random.uniform(-0.3, 0.2))
                chlorine = max(0.3, 1.2 - surge * 0.5 + random.uniform(-0.05, 0.05))
                turbidity = 0.8 + surge * 2.0 + random.uniform(-0.2, 0.5)
                ph = 7.2 + surge * 0.3 + random.uniform(-0.1, 0.1)
                pump_temp = 42 + surge * 20 + random.uniform(-2, 5)
                pump_vib = 0.08 + surge * 0.6 + random.uniform(0, 0.1)
                power = 45 + surge * 15 + random.uniform(-3, 5)
                reservoir = max(8, 82 - progress * 70 + random.uniform(-5, 5))
                health = "HEALTHY" if surge < 0.5 else ("STRESSED" if surge < 0.8 else "AT_RISK")
                fail = 1 if reservoir < 15 else 0
            
            writer.writerow({
                "timestamp": t.isoformat(),
                "node_id": "WTR_PLANT_A",
                "flow_rate_lps": round(max(0, flow), 2),
                "capacity_lps": 100,
                "load_ratio": round(max(0, flow / 100), 4),
                "pressure_bar": round(max(0, pressure), 2),
                "pressure_deviation": round(abs(pressure - 4.5) / 4.5, 4),
                "chlorine_ppm": round(max(0, chlorine), 3),
                "turbidity_ntu": round(max(0, turbidity), 3),
                "ph_level": round(max(0, ph), 2),
                "pump_temperature": round(max(10, pump_temp), 2),
                "pump_vibration": round(max(0, pump_vib), 4),
                "power_supply_kw": round(max(0, power), 2),
                "reservoir_level_pct": round(max(0, min(100, reservoir)), 2),
                "pipeline_age_years": 18,
                "population_served": 200000,
                "health_status": health,
                "failure_label": fail
            })
    print(f"  ✓ Generated {filepath} ({rows} rows)")


if __name__ == "__main__":
    print("=" * 60)
    print("ResilienceOS — Generating 15 Telemetry Datasets")
    print("=" * 60)
    
    print("\n📊 Substation (PWR_SUB_A) — 5 scenarios:")
    sub_scenarios = [
        (1, "normal_ops"),
        (2, "gradual_overload"),
        (3, "sudden_spike"),
        (4, "weather_stress"),
        (5, "cascading_failure")
    ]
    for num, name in sub_scenarios:
        gen_substation_dataset(num, name, rows=120)
    
    print("\n🚧 Road (TRN_ROAD_R1) — 5 scenarios:")
    road_scenarios = [
        (1, "normal_traffic"),
        (2, "flood_blockage"),
        (3, "debris_accident"),
        (4, "construction_lane_closure"),
        (5, "peak_hour_gridlock")
    ]
    for num, name in road_scenarios:
        gen_road_dataset(num, name, rows=120)
    
    print("\n💧 Water Plant (WTR_PLANT_A) — 5 scenarios:")
    water_scenarios = [
        (1, "normal_supply"),
        (2, "pump_degradation"),
        (3, "contamination_event"),
        (4, "power_loss_impact"),
        (5, "demand_surge")
    ]
    for num, name in water_scenarios:
        gen_water_dataset(num, name, rows=120)
    
    print(f"\n✅ All 15 datasets generated in: {OUTPUT_DIR}")
    print(f"   Total: 15 files × 120 rows = 1,800 telemetry records")
