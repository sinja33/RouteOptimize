from pydantic import BaseModel

class Vehicle(BaseModel):
    vehicle_id: str
    type: str  # truck / bike
    max_capacity_kg: float
    fuel_type: str
    emission_g_co2_per_km: int
