"""
DFMEA Backend — FastAPI  v2.0
Modular: each concern lives in its own router module.

Run:
    uvicorn main:app --reload --port 8000

API surface
-----------
POST  /api/dfmea/failure-modes            Generate failure modes for a focus function
POST  /api/dfmea/failure-causes           Generate causes for one (mode × lower fn) pair
POST  /api/dfmea/failure-causes/bulk      Generate causes for all mode × lower fn combos
POST  /api/dfmea/failure-effects          Generate effect for a single row
POST  /api/dfmea/failure-effects/bulk     Generate effects for all confirmed rows
POST  /api/dfmea/severity-rate/bulk       LLM-rated severity for all rows
POST  /api/dfmea/risk-rating              Compute O, D, RPN from qualitative answers
POST  /api/dfmea/risk-rating/bulk         Bulk version of above
POST  /api/dfmea/similarity/suggest       Titan-embedding connection suggestions
POST  /api/dfmea/p-diagram/functions      Derive P-diagram outputs from function names
POST  /api/dfmea/export/template          Generate filled DFMEA .xlsx download
GET   /health                             Health check

Removed in v2.0:
    /api/dfmea/generate-diagrams  — B-diagram is now rendered entirely on the
                                    frontend from element names; P-diagram is
                                    user-filled in the wizard.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import (
    failure_modes,
    failure_causes,
    failure_effects,
    risk_rating,
    severity,
    similarity,
    p_diagram,
    export_template,
)

app = FastAPI(title="DFMEA API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(failure_modes.router,    prefix="/api/dfmea")
app.include_router(failure_causes.router,   prefix="/api/dfmea")
app.include_router(failure_effects.router,  prefix="/api/dfmea")
app.include_router(risk_rating.router,      prefix="/api/dfmea")
app.include_router(severity.router,         prefix="/api/dfmea")
app.include_router(similarity.router,       prefix="/api/dfmea")
app.include_router(p_diagram.router,        prefix="/api/dfmea")
app.include_router(export_template.router,  prefix="/api/dfmea")


@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}
