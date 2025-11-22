import csv

def parse_vehicles(csv_path: str):
    vehicles = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for i, row in enumerate(reader):
            vehicles.append({
                "id": i + 1,
                "description": row["vehicle_id"],
                "capacity": [float(row["max_capacity_kg"])],
                "profile": "bike" if row["type"] == "bike" else "truck",
                "skills": [],
            })
    return vehicles
