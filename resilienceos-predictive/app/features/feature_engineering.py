from typing import List, Dict, Any

def extract_features(telemetry_history: List[Dict[str, Any]], node_profile: Dict[str, Any]) -> Dict[str, float]:
    """
    Extract features from telemetry history (assumed to be sorted by time ascending).
    """
    if not telemetry_history:
        return {}

    latest = telemetry_history[-1]
    
    # 1. Load Ratio
    capacity = node_profile.get("rated_capacity", 100)
    load = latest.get("load_kw", 0)
    load_ratio = load / capacity if capacity > 0 else 0

    # 2. Voltage Deviation
    nominal_voltage = node_profile.get("normal_operating_range", {}).get("voltage", 230)
    current_voltage = latest.get("voltage", nominal_voltage)
    voltage_deviation = abs(current_voltage - nominal_voltage) / nominal_voltage if nominal_voltage > 0 else 0

    # 3. Temperature Trend (if we have history)
    temp_trend = 0.0
    if len(telemetry_history) >= 2:
        temps = [t.get("temperature", 50) for t in telemetry_history if t.get("temperature") is not None]
        if len(temps) >= 2:
            temp_trend = temps[-1] - temps[0]  # simple diff over the window

    features = {
        "load_ratio": load_ratio,
        "voltage_deviation": voltage_deviation,
        "temperature": latest.get("temperature", 50),
        "temperature_trend": temp_trend,
        "vibration": latest.get("vibration", 0.0)
    }
    return features
