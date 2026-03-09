"""
routers/failure_modes.py
POST /api/dfmea/failure-modes
"""

from fastapi import APIRouter
from pydantic import BaseModel
from llm_client import llm

router = APIRouter()


class FailureModesRequest(BaseModel):
    focus_function_name: str
    focus_element_name:  str


def _parse_bullets(text: str) -> list[str]:
    lines = [l.strip("–•- ").strip() for l in text.split("\n")]
    return [l for l in lines if len(l) > 5 and l.upper() != "NONE"]


def generate_failure_modes(focus_function_name: str, focus_element_name: str) -> list[str]:
    prompt = f"""TASK: Generate failure modes for the focus element function.

Focus element: {focus_element_name}
Focus element function: {focus_function_name}

Rules:
- Consider all 4 archetypes:
  1. Function not happening (complete loss)
  2. Function happening partially or too slowly (degraded)
  3. Function happening incorrectly or excessively (wrong output)
  4. Function happening intermittently (random dropout)
- Only return technically realistic cases — skip archetypes with no plausible mode
- Do NOT include causes or effects
- Each failure mode must be ONE sentence describing HOW the function fails

OUTPUT RULES:
- Output bullet points only
- If no realistic failure mode exists, output exactly: NONE
OUTPUT FORMAT:
- <failure mode sentence>
"""
    raw = llm.generate(prompt, max_tokens=800)
    return _parse_bullets(raw)


@router.post("/failure-modes")
def failure_modes_endpoint(req: FailureModesRequest):
    modes = generate_failure_modes(req.focus_function_name, req.focus_element_name)
    return {"failure_modes": modes}
