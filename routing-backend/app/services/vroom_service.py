import httpx

async def call_vroom(jobs, vehicles):
    payload = {
        "jobs": jobs,
        "vehicles": vehicles
    }
    async with httpx.AsyncClient() as client:
        r = await client.post("http://localhost:3000", json=payload)
        r.raise_for_status()
        return r.json()
