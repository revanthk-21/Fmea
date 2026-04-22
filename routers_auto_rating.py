"""
routers/auto_rating.py
POST /api/dfmea/auto-rating/bulk

Given a list of causes (with their context), ask the LLM to assign
occurrence_answer and detection_answer using the same qualitative scale
the user would pick manually.

Returns the same answer keys the frontend OptionPills use:
  occurrence_answer: "very_high" | "high" | "moderate" | "low" | "very_low" | "unlikely"
  detection_answer:  "unlikely"  | "low"  | "moderate" | "high" | "certain"

The LLM is given the full rubric for each so its choices are calibrated to
the AIAG-VDA scale, not guessed. The frontend then calls computeRating()
on the returned answers exactly as it does for manual picks.
"""

import json
import re
from fastapi import APIRouter
from pydantic import BaseModel
from llm_client import llm

router = APIRouter()


# ── Models ─────────────────────────────────────────────────────────────────────

class CauseRatingRequest(BaseModel):
    cause_id:            str
    cause:               str
    noise_factor:        str
    noise_category:      str
    failure_mode:        str
    focus_function:      str
    focus_element:       str
    lower_element:       str
    lower_function:      str
    prevention_methods:  str = ""
    detection_methods:   str = ""


class BulkAutoRatingRequest(BaseModel):
    causes: list[CauseRatingRequest]


class CauseRatingResult(BaseModel):
    cause_id:          str
    occurrence_answer: str
    detection_answer:  str
    occurrence:        int
    detection:         int
    reasoning:         str   # short justification shown in UI tooltip


# ── Rubrics (match the frontend OptionPills exactly) ───────────────────────────

OCCURRENCE_RUBRIC = """
Occurrence likelihood scale — pick ONE:
  "very_high" (O=9): Almost certain. Failure mechanism is well-known and frequently seen in field.
  "high"      (O=7): Will occur with some regularity under these conditions.
  "moderate"  (O=5): Occasional occurrence expected. Has happened before on similar systems.
  "low"       (O=3): Unlikely but possible. Seen rarely.
  "very_low"  (O=2): Very unlikely. Near the edge of what the noise factor can cause.
  "unlikely"  (O=1): Failure virtually excluded. Extremely robust against this noise factor.
""".strip()

DETECTION_RUBRIC = """
Detection likelihood scale — pick ONE:
  "unlikely"  (D=9): No test method exists or cannot detect this cause before customer delivery.
  "low"       (D=7): A detection method exists but is unproven or indirect for this cause.
  "moderate"  (D=5): A proven detection method exists from a comparable product.
  "high"      (D=3): Proven detection method confirmed and validated for this specific product.
  "certain"   (D=1): Automated or continuous detection — failure cannot escape to customer.
""".strip()

O_MAP = {
    "very_high": 9, "high": 7, "moderate": 5,
    "low": 3, "very_low": 2, "unlikely": 1,
}
D_MAP = {
    "unlikely": 9, "low": 7, "moderate": 5,
    "high": 3, "certain": 1,
}

VALID_O = set(O_MAP.keys())
VALID_D = set(D_MAP.keys())


# ── Core LLM call ──────────────────────────────────────────────────────────────

def _rate_cause(req: CauseRatingRequest) -> CauseRatingResult:
    prevention = req.prevention_methods.strip() or "None specified"
    detection  = req.detection_methods.strip()  or "None specified"

    prompt = f"""You are a senior DFMEA engineer. Assign Occurrence and Detection ratings for this failure cause.

CONTEXT
-------
Focus element   : {req.focus_element}
Focus function  : {req.focus_function}
Failure mode    : {req.failure_mode}
Lower element   : {req.lower_element}
Lower function  : {req.lower_function}
Failure cause   : {req.cause}
Noise factor    : {req.noise_factor} ({req.noise_category})
Prevention ctrl : {prevention}
Detection ctrl  : {detection}

OCCURRENCE RUBRIC
-----------------
{OCCURRENCE_RUBRIC}

DETECTION RUBRIC
----------------
{DETECTION_RUBRIC}

TASK
----
1. Assess how likely this cause will occur given the noise factor and prevention controls.
2. Assess how likely the detection controls will catch this cause before it reaches the customer.
3. Give a one-sentence justification for each.

Output ONLY valid JSON, no markdown:
{{
  "occurrence_answer": "<one of the occurrence keys>",
  "detection_answer":  "<one of the detection keys>",
  "occurrence_reasoning": "<one sentence>",
  "detection_reasoning":  "<one sentence>"
}}"""

    raw = llm.generate(prompt, max_tokens=250)

    # Strip markdown fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"\s*```$", "", raw)

    try:
        data = json.loads(raw.strip())
    except Exception:
        # Fallback: extract keys with regex
        data = {}
        for key in ("occurrence_answer", "detection_answer",
                    "occurrence_reasoning", "detection_reasoning"):
            m = re.search(rf'"{key}"\s*:\s*"([^"]+)"', raw)
            if m:
                data[key] = m.group(1)

    o_ans = data.get("occurrence_answer", "moderate")
    d_ans = data.get("detection_answer",  "moderate")

    # Validate — fall back to "moderate" if LLM returned an invalid key
    if o_ans not in VALID_O:
        o_ans = "moderate"
    if d_ans not in VALID_D:
        d_ans = "moderate"

    reasoning = (
        f"O: {data.get('occurrence_reasoning', '—')} "
        f"| D: {data.get('detection_reasoning', '—')}"
    )

    return CauseRatingResult(
        cause_id=req.cause_id,
        occurrence_answer=o_ans,
        detection_answer=d_ans,
        occurrence=O_MAP[o_ans],
        detection=D_MAP[d_ans],
        reasoning=reasoning,
    )


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("/auto-rating/bulk")
def auto_rating_bulk(req: BulkAutoRatingRequest):
    """
    Auto-assign O and D answers for a list of causes.

    Response:
    {
      "results": [
        {
          "cause_id":          "c_abc123",
          "occurrence_answer": "moderate",
          "detection_answer":  "high",
          "occurrence":        5,
          "detection":         3,
          "reasoning":         "O: ... | D: ..."
        },
        ...
      ]
    }
    """
    results = []
    for cause in req.causes:
        try:
            result = _rate_cause(cause)
            results.append(result.dict())
        except Exception as e:
            # Don't fail the whole batch — return moderate as safe default
            results.append({
                "cause_id":          cause.cause_id,
                "occurrence_answer": "moderate",
                "detection_answer":  "moderate",
                "occurrence":        5,
                "detection":         5,
                "reasoning":         f"Auto-rating failed: {str(e)[:80]}",
            })

    return {"results": results}
