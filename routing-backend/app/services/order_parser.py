import csv
from app.models.order import Order
from app.services.geocoder import geocode

async def parse_orders(csv_path: str):
    orders = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
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
            coords = await geocode(full_address)
            if coords:
                order.lat, order.lng = coords
            
            orders.append(order)

    return orders
