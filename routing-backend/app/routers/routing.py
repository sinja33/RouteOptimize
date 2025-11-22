from fastapi import APIRouter
from app.services.order_parser import parse_orders
from app.services.vehicle_parser import parse_vehicles
from app.services.vroom_service import call_vroom

router = APIRouter()

@router.post("/optimize")
async def optimize_route(orders_csv: str, vehicles_csv: str):
    orders = await parse_orders(orders_csv)
    vehicles = parse_vehicles(vehicles_csv)

    jobs = []
    for i, o in enumerate(orders):
        jobs.append({
            "id": i + 1,
            "location": [o.lng, o.lat],
            "delivery": [o.weight],
            "time_windows": [[convert_time(o.window_start), convert_time(o.window_end)]]
        })

    solution = await call_vroom(jobs, vehicles)
    return solution
