"""
DFMEA Backend — FastAPI
Modular: each concern lives in its own module.
Run: uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import failure_modes, failure_causes, failure_effects, risk_rating

app = FastAPI(title="DFMEA API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(failure_modes.router,   prefix="/api/dfmea")
app.include_router(failure_causes.router,  prefix="/api/dfmea")
app.include_router(failure_effects.router, prefix="/api/dfmea")
app.include_router(risk_rating.router,     prefix="/api/dfmea")


@app.get("/health")
def health():
    return {"status": "ok"}
