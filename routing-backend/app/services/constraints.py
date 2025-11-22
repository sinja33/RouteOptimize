def apply_constraints_to_osrm(orders, weather_data, congestion_data):
    avoid = set()

    for segment in weather_data.get("unsafe_segments", []):
        avoid.add(segment)

    for segment in congestion_data.get("red", []):
        avoid.add(segment)

    return list(avoid)
