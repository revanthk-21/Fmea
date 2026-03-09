"""
routers/risk_rating.py
POST /api/dfmea/risk-rating

Converts qualitative user answers + free-text controls into O, D, RPN.
Also accepts bulk rows for the full DFMEA run endpoint.
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


# ── Occurrence table (Bosch / AIAG-VDA aligned) ───────────────────────────────
# Maps qualitative likelihood answer → O rating
OCCURRENCE_MAP = {
    "very_high": 9,
    "high":      7,
    "moderate":  5,
    "low":       3,
    "very_low":  2,
    "unlikely":  1,
}

# ── Detection table (Bosch / AIAG-VDA aligned) ────────────────────────────────
# Maps qualitative detectability answer → D rating
DETECTION_MAP = {
    "unlikely":  9,
    "low":       7,
    "moderate":  5,
    "high":      3,
    "certain":   1,
}

# ── Occurrence labels (for display) ──────────────────────────────────────────
OCCURRENCE_LABELS = {
    9: "Very High",
    7: "High",
    5: "Moderate",
    3: "Low",
    2: "Very Low",
    1: "Unlikely",
}

DETECTION_LABELS = {
    9: "Unlikely",
    7: "Low",
    5: "Moderate",
    3: "High",
    1: "Certain",
}


def compute_rpn(severity: int, occurrence: int, detection: int) -> int:
    return severity * occurrence * detection


def action_priority(rpn: int, severity: int) -> str:
    """
    Simple AIAG-VDA action priority logic:
    H = High priority action required
    M = Medium priority
    L = Low priority
    """
    if severity >= 9 or rpn >= 200:
        return "H"
    if severity >= 7 or rpn >= 100:
        return "M"
    return "L"


# ── Request / Response models ─────────────────────────────────────────────────

class RatingRequest(BaseModel):
    severity:                   int          # 1-10, provided by user
    occurrence_answer:          str          # very_high | high | moderate | low | very_low | unlikely
    detection_answer:           str          # unlikely | low | moderate | high | certain
    prevention_methods:         list[str]    # free text, stored for reference
    detection_methods:          list[str]    # free text, stored for reference


class BulkRatingRow(BaseModel):
    row_id:                     str
    severity:                   int
    occurrence_answer:          str
    detection_answer:           str
    prevention_methods:         list[str]
    detection_methods:          list[str]


class BulkRatingRequest(BaseModel):
    rows: list[BulkRatingRow]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/risk-rating")
def risk_rating_endpoint(req: RatingRequest):
    o = OCCURRENCE_MAP.get(req.occurrence_answer, 5)
    d = DETECTION_MAP.get(req.detection_answer, 5)
    rpn = compute_rpn(req.severity, o, d)
    ap  = action_priority(rpn, req.severity)

    return {
        "occurrence":          o,
        "occurrence_label":    OCCURRENCE_LABELS.get(o, ""),
        "detection":           d,
        "detection_label":     DETECTION_LABELS.get(d, ""),
        "rpn":                 rpn,
        "action_priority":     ap,
        "prevention_methods":  req.prevention_methods,
        "detection_methods":   req.detection_methods,
    }


@router.post("/risk-rating/bulk")
def risk_rating_bulk(req: BulkRatingRequest):
    results = []
    for row in req.rows:
        o   = OCCURRENCE_MAP.get(row.occurrence_answer, 5)
        d   = DETECTION_MAP.get(row.detection_answer, 5)
        rpn = compute_rpn(row.severity, o, d)
        ap  = action_priority(rpn, row.severity)

        results.append({
            "row_id":             row.row_id,
            "occurrence":         o,
            "occurrence_label":   OCCURRENCE_LABELS.get(o, ""),
            "detection":          d,
            "detection_label":    DETECTION_LABELS.get(d, ""),
            "rpn":                rpn,
            "action_priority":    ap,
            "prevention_methods": row.prevention_methods,
            "detection_methods":  row.detection_methods,
        })

    return {"results": results}


@router.get("/occurrence-options")
def occurrence_options():
    return {"options": [
        {"value": "very_high", "label": "Very High",  "description": "Almost certain to occur repeatedly",     "rating": 9},
        {"value": "high",      "label": "High",       "description": "Will occur with some regularity",        "rating": 7},
        {"value": "moderate",  "label": "Moderate",   "description": "Occasional occurrence expected",         "rating": 5},
        {"value": "low",       "label": "Low",        "description": "Occurrence is low",                      "rating": 3},
        {"value": "very_low",  "label": "Very Low",   "description": "Occurrence is very low",                 "rating": 2},
        {"value": "unlikely",  "label": "Unlikely",   "description": "Failure excluded or extremely unlikely", "rating": 1},
    ]}


@router.get("/detection-options")
def detection_options():
    return {"options": [
        {"value": "unlikely",  "label": "Unlikely",  "description": "No method exists or test cannot detect",         "rating": 9},
        {"value": "low",       "label": "Low",        "description": "Method exists but unproven or indirect",        "rating": 7},
        {"value": "moderate",  "label": "Moderate",   "description": "Proven method from comparable product/process", "rating": 5},
        {"value": "high",      "label": "High",       "description": "Proven method confirmed for this product",      "rating": 3},
        {"value": "certain",   "label": "Certain",    "description": "Automated / continuous detection guaranteed",   "rating": 1},
    ]}
