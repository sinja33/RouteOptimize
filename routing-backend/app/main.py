from fastapi import FastAPI
from app.routers import routing, health

app = FastAPI(title="Routing Backend")

app.include_router(routing.router)
# app.include_router(health.router)
