from fastapi import APIRouter
from app.services.order_parser import parse_orders
from app.services.vehicle_parser import parse_vehicles
from app.services.vroom_service import call_vroom
from app.utils.time_windows import convert_time
from tqdm.asyncio import tqdm  # async-friendly progress bars
import asyncio

router = APIRouter()

ORDERS_FILE = "/data/orders.csv"
VEHICLES_FILE = "/data/delivery_vehicles.csv"

@router.post("/optimize")
async def optimize_route(orders_csv: str = ORDERS_FILE, vehicles_csv: str = VEHICLES_FILE):
    print(f"[INFO] Loading orders from {orders_csv}...")
    orders = await parse_orders(orders_csv)
    print(f"[INFO] Loaded {len(orders)} orders.")

    print(f"[INFO] Loading vehicles from {vehicles_csv}...")
    vehicles = parse_vehicles(vehicles_csv)
    print(f"[INFO] Loaded {len(vehicles)} vehicles.")

    print("[INFO] Preparing jobs for VROOM...")
    jobs = []
    for i, o in enumerate(orders):
        jobs.append({
            "id": i + 1,
            "location": [o.lng, o.lat],
            "delivery": [o.weight],
            "time_windows": [[convert_time(o.window_start), convert_time(o.window_end)]]
        })
        if i % 10 == 0:
            print(f"[INFO] Prepared {i+1}/{len(orders)} jobs...")

    print("[INFO] Sending jobs to VROOM...")
    solution = await call_vroom(jobs, vehicles)
    print("[INFO] Received solution from VROOM.")

    return solution
