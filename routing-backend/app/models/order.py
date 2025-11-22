from pydantic import BaseModel
from typing import Optional

class Order(BaseModel):
    order_id: str
    weight: float
    priority: str
    window_start: str  # HH:MM
    window_end: str
    street: str
    house_number: str
    postal_code: Optional[str]
    city: str
    lat: Optional[float] = None
    lng: Optional[float] = None
