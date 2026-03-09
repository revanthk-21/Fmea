"""
routers/failure_causes.py
POST /api/dfmea/failure-causes  — generate causes for all selected failure modes
POST /api/dfmea/failure-effects — generate effects for confirmed cause rows
"""

from fastapi import APIRouter
from pydantic import BaseModel
from llm_client import llm

router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────

class CauseRequest(BaseModel):
    focus_element:        str
    focus_function:       str
    failure_mode:         str
    lower_element:        str
    lower_function:       str
    noise_factors:        dict[str, list[str]]   # {category: [factors]}


class CauseItem(BaseModel):
    cause:             str
    noise_category:    str
    noise_factor:      str


class CausesResponse(BaseModel):
    causes: list[CauseItem]


class BulkCausesRequest(BaseModel):
    """Generate causes for multiple (failure_mode, lower_function) combinations at once."""
    focus_element:    str
    focus_function:   str
    failure_modes:    list[str]
    lower_connections: list[dict]   # [{lower_element, lower_function}]
    noise_factors:    dict[str, list[str]]


# ── Core generation logic ─────────────────────────────────────────────────────

def _parse_bullet(text: str) -> str:
    return text.strip("–•- ").strip()


def generate_causes_for_mode(
    focus_element: str,
    focus_function: str,
    failure_mode: str,
    lower_element: str,
    lower_function: str,
    noise_factors: dict[str, list[str]],
) -> list[CauseItem]:
    causes = []

    for category, factors in noise_factors.items():
        for factor in factors:
            if not factor.strip():
                continue
            noise_str = f"{category}: {factor}"

            prompt = f"""TASK: Generate Failure Cause

Lower-level element: {lower_element}
Lower-level function: {lower_function}
Focus element: {focus_element}
Focus function: {focus_function}
Failure mode: "{failure_mode}"
Noise factor: {noise_str}

Rules:
- Cause must originate in the lower-level element/function
- The cause MUST be triggered by the given noise factor
- Must be specific, measurable, and physically/electrically grounded
- Do NOT include effects or restate the failure mode

OUTPUT RULES:
- If NO realistic cause exists, output exactly: NONE
- Otherwise output exactly 1 bullet point with one failure cause
OUTPUT FORMAT:
- <failure cause sentence>
"""
            raw = llm.generate(prompt, max_tokens=300).strip()
            if raw and raw.upper() != "NONE":
                line = next((l for l in raw.split("\n") if l.strip()), raw)
                causes.append(CauseItem(
                    cause=_parse_bullet(line),
                    noise_category=category,
                    noise_factor=factor,
                ))

    return causes


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/failure-causes", response_model=CausesResponse)
def failure_causes_endpoint(req: CauseRequest):
    causes = generate_causes_for_mode(
        focus_element=req.focus_element,
        focus_function=req.focus_function,
        failure_mode=req.failure_mode,
        lower_element=req.lower_element,
        lower_function=req.lower_function,
        noise_factors=req.noise_factors,
    )
    return CausesResponse(causes=causes)


@router.post("/failure-causes/bulk")
def failure_causes_bulk(req: BulkCausesRequest):
    """
    Generate causes for all combinations of:
      failure_modes × lower_connections
    Returns flat list with mode + lower_function context for frontend grouping.
    """
    results = []

    for mode in req.failure_modes:
        for conn in req.lower_connections:
            causes = generate_causes_for_mode(
                focus_element=req.focus_element,
                focus_function=req.focus_function,
                failure_mode=mode,
                lower_element=conn["lower_element"],
                lower_function=conn["lower_function"],
                noise_factors=req.noise_factors,
            )
            results.append({
                "failure_mode":    mode,
                "lower_element":   conn["lower_element"],
                "lower_function":  conn["lower_function"],
                "causes":          [c.dict() for c in causes],
            })

    return {"groups": results}
