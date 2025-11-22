async def get_route_matrix(locations, avoid_roads=None):
    """
    - locations = list of (lon,lat)
    - avoid_roads = list of road IDs or bounding boxes
    """

    # OSRM table call
    coords = ";".join([f"{lon},{lat}" for lat, lon in locations])
    url = f"http://localhost:5000/table/v1/car/{coords}"

    # Optional: add U-turn penalties, exclude areas
    params = {}
    if avoid_roads:
        params["exclude"] = ",".join(avoid_roads)

    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params)
        return r.json()
