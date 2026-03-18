"""
routers/p_diagram.py
POST /api/dfmea/p-diagram/functions

Called when the user enters the P-Diagram step (Step 3).
Accepts the focus functions that were typed in Step 2 and returns:

  - functions:  the same list (passed through, used to pre-populate the
                read-only Functions column in the P-diagram)
  - outputs:    one derived "completed function" string per function,
                e.g. "Maintain geometry" → "Geometry maintained"

The frontend can call this endpoint once on step entry to ensure its
derived outputs are consistent with the backend logic, or it can use
its own JS implementation of derivedOutput() and skip this call entirely.
Both approaches produce the same result.

No LLM call — this is pure string manipulation.
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

# ── Verb → past-participle lookup ─────────────────────────────────────────────

_PP: dict[str, str] = {
    "maintain":  "maintained",
    "manage":    "managed",
    "transfer":  "transferred",
    "enable":    "enabled",
    "absorb":    "absorbed",
    "deliver":   "delivered",
    "support":   "supported",
    "provide":   "provided",
    "control":   "controlled",
    "limit":     "limited",
    "resist":    "resisted",
    "prevent":   "prevented",
    "transmit":  "transmitted",
    "reduce":    "reduced",
    "protect":   "protected",
    "ensure":    "ensured",
    "carry":     "carried",
    "hold":      "held",
    "guide":     "guided",
    "isolate":   "isolated",
    "seal":      "sealed",
    "distribute":"distributed",
    "convert":   "converted",
    "generate":  "generated",
    "detect":    "detected",
    "monitor":   "monitored",
    "regulate":  "regulated",
    "connect":   "connected",
    "mount":     "mounted",
    "attach":    "attached",
    "align":     "aligned",
    "allow":     "allowed",
    "withstand": "withstood",
    "dissipate": "dissipated",
    "retain":    "retained",
    "position":  "positioned",
    "measure":   "measured",
    "route":     "routed",
    "filter":    "filtered",
}


def derive_output(function_name: str) -> str:
    """
    Convert a function name into a completed-function output string.

    Strategy  :  "Verb NounPhrase" → "NounPhrase verbed"
    Fallback  :  append " achieved"

    Examples
    --------
    "Maintain geometry"          → "Geometry maintained"
    "Enable wheel rotation"      → "Wheel rotation enabled"
    "Absorb road induced vibration" → "Road induced vibration absorbed"
    "Braking"                    → "Braking achieved"
    """
    name = function_name.strip()
    if not name:
        return ""

    words = name.split()
    if len(words) < 2:
        return f"{name} achieved"

    verb  = words[0].lower()
    rest  = " ".join(words[1:])

    if verb in _PP:
        past_tense = _PP[verb]
    elif verb.endswith("e"):
        past_tense = verb + "d"
    elif verb.endswith("y") and len(verb) > 2 and verb[-2] not in "aeiou":
        past_tense = verb[:-1] + "ied"
    else:
        past_tense = verb + "ed"

    # Capitalise the noun phrase
    result = rest[0].upper() + rest[1:] if rest else ""
    return f"{result} {past_tense}".strip()


# ── Request / Response models ─────────────────────────────────────────────────

class PDiagramFunctionsRequest(BaseModel):
    """
    focus_functions: list of focus-function names from Step 2
                     (only the focus-element functions — not lower/higher)
    """
    focus_functions: list[str]


class PDiagramFunctionsResponse(BaseModel):
    functions: list[str]   # echoed back (pass-through)
    outputs:   list[str]   # one derived output per function


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/p-diagram/functions", response_model=PDiagramFunctionsResponse)
def p_diagram_functions(req: PDiagramFunctionsRequest):
    """
    Derive P-diagram 'Outputs' from focus function names.

    Inputs
    ------
    {
        "focus_functions": ["Maintain geometry", "Manage forces", "Enable wheel rotation"]
    }

    Outputs
    -------
    {
        "functions": ["Maintain geometry", "Manage forces", "Enable wheel rotation"],
        "outputs":   ["Geometry maintained", "Forces managed", "Wheel rotation enabled"]
    }
    """
    fns  = [f.strip() for f in req.focus_functions if f.strip()]
    outs = [derive_output(f) for f in fns]
    return PDiagramFunctionsResponse(functions=fns, outputs=outs)
