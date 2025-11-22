import csv
import os
from app.models.order import Order
from app.services.geocoder import geocode

CACHE_FILE = "/data/orders_geocoded.csv"  # cached file with lat/lng

async def parse_orders(csv_path: str):
    orders = []

    # If cached file exists, load from it
    if os.path.exists(CACHE_FILE):
        print(f"[INFO] Loading cached orders from {CACHE_FILE}...")
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            reader = list(csv.DictReader(f, delimiter=";"))
            total = len(reader)
            for idx, row in enumerate(reader, start=1):
                order = Order(
                    order_id=row["OrderID"],
                    weight=float(row["Weight(kg)"].replace(",", ".")),
                    priority=row["Priority"],
                    window_start=row["WindowStart"],
                    window_end=row["WindowEnd"],
                    street=row["street"],
                    house_number=row["house_number"],
                    postal_code=row.get("postal_code", None),
                    city=row["city"],
                    lat=float(row["lat"]),
                    lng=float(row["lng"])
                )
                orders.append(order)
                if idx % 5 == 0 or idx == total:
                    print(f"[INFO] Loaded {idx}/{total} cached orders...")
        return orders

    # Otherwise, read original CSV and geocode
    print(f"[INFO] Reading orders from {csv_path} and geocoding addresses...")
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = list(csv.DictReader(f, delimiter=";"))
        total = len(reader)
        for idx, row in enumerate(reader, start=1):
            order = Order(
                order_id=row["OrderID"],
                weight=float(row["Weight(kg)"].replace(",", ".")),
                priority=row["Priority"],
                window_start=row["WindowStart"],
                window_end=row["WindowEnd"],
                street=row["street"],
                house_number=row["house_number"],
                postal_code=row.get("postal_code", None),
                city=row["city"]
            )

            full_address = f"{order.street} {order.house_number}, {order.postal_code or ''} {order.city}"
            print(f"[INFO] Geocoding {order.order_id}: {full_address} ({idx}/{total})...")
            coords = await geocode(full_address)
            if coords:
                order.lat, order.lng = coords
                print(f"[INFO] Got coordinates: {order.lat}, {order.lng}")
            else:
                print(f"[WARN] Failed to geocode {order.order_id}")

            orders.append(order)

    # Save to cache CSV
    print(f"[INFO] Saving geocoded orders to {CACHE_FILE}...")
    with open(CACHE_FILE, "w", encoding="utf-8", newline="") as f:
        fieldnames = ["OrderID","Weight(kg)","Priority","WindowStart","WindowEnd",
                      "street","house_number","postal_code","city","lat","lng"]
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        for o in orders:
            writer.writerow({
                "OrderID": o.order_id,
                "Weight(kg)": o.weight,
                "Priority": o.priority,
                "WindowStart": o.window_start,
                "WindowEnd": o.window_end,
                "street": o.street,
                "house_number": o.house_number,
                "postal_code": o.postal_code,
                "city": o.city,
                "lat": o.lat,
                "lng": o.lng
            })

    print(f"[INFO] Finished processing {len(orders)} orders.")
    return orders
