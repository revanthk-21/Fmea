"""
routers/failure_effects.py
POST /api/dfmea/failure-effects
"""

from fastapi import APIRouter
from pydantic import BaseModel
from llm_client import llm

router = APIRouter()


class EffectRequest(BaseModel):
    focus_element:        str
    focus_function:       str
    failure_mode:         str
    higher_element:       str
    higher_function:      str


class EffectsBulkRequest(BaseModel):
    """Generate effects for multiple confirmed cause rows."""
    rows: list[dict]   # each: {focus_element, focus_function, failure_mode,
                       #        higher_element, higher_function, row_id}


def generate_effect(
    focus_element: str,
    focus_function: str,
    failure_mode: str,
    higher_element: str,
    higher_function: str,
) -> str:
    prompt = f"""TASK: Generate Failure Effect

Higher-level element: {higher_element}
Higher-level function: {higher_function}
Focus element: {focus_element}
Focus element failure mode: "{failure_mode}"

DEFINITION:
A failure effect describes the loss or degradation of the higher-level function
caused by the focus element failure mode.

REQUIREMENTS:
- The effect MUST describe the impact on the higher-level function only
- Do NOT include the cause or focus element behavior
- The effect MUST be ONE sentence
- Be specific — avoid generic phrases like "system does not work"

OUTPUT FORMAT:
<failure effect sentence>
"""
    return llm.generate(prompt, max_tokens=200).strip()


@router.post("/failure-effects")
def failure_effects_endpoint(req: EffectRequest):
    effect = generate_effect(
        focus_element=req.focus_element,
        focus_function=req.focus_function,
        failure_mode=req.failure_mode,
        higher_element=req.higher_element,
        higher_function=req.higher_function,
    )
    return {"failure_effect": effect}


@router.post("/failure-effects/bulk")
def failure_effects_bulk(req: EffectsBulkRequest):
    """Generate effects for multiple rows in one call."""
    results = []
    for row in req.rows:
        effect = generate_effect(
            focus_element=row["focus_element"],
            focus_function=row["focus_function"],
            failure_mode=row["failure_mode"],
            higher_element=row["higher_element"],
            higher_function=row["higher_function"],
        )
        results.append({
            "row_id":         row.get("row_id"),
            "failure_effect": effect,
        })
    return {"results": results}
