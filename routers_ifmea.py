"""
routers/ifmea.py
================
Interface Failure Mode and Effects Analysis (IFMEA)

UPDATED LOGIC
-------------
Failure modes:  Reused directly from the DFMEA (Step 6).
                The same functional failures apply — the IFMEA just provides
                an alternative causal path through the interface rather than
                through the component internally.

Failure causes: Generated from how the INTERFACE MECHANISM degrades under
                each noise factor, causing the given failure mode.
                Causes must originate in the interface itself (connector,
                coupling, protocol layer, fluid path) — not inside either
                connected element.

Endpoints
---------
POST /api/ifmea/interface-causes/bulk
    Takes dfmea_failure_modes[] (reused from Step 6) + noise_factors.
    For each (mode × noise_factor): generate one interface-mechanism cause.

POST /api/ifmea/interface-effects/bulk
    Bidirectional effects on sender and receiver. Now also accepts
    interface_cause for a richer, more specific prompt.

POST /api/ifmea/interface-severity/bulk
    Unchanged — rates severity from effect on receiver.
"""

import json
import re
from fastapi import APIRouter
from pydantic import BaseModel
from llm_client import llm

router = APIRouter()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _strip_json(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

def _parse_bullet(text: str) -> str:
    return text.strip("–•- \n").strip()


CONN_DESCRIPTIONS = {
    "P": "Physical connection (mechanical joint, fastener, spline, bearing, weld, press fit)",
    "E": "Energy transfer (torque coupling, electrical conductor, hydraulic line, thermal path)",
    "I": "Information transfer (CAN/LIN bus, sensor signal, RF link, digital protocol)",
    "M": "Material transfer (fluid line, coolant circuit, exhaust path, lubrication circuit)",
}


# ═══════════════════════════════════════════════════════════════════════════════
# 1. INTERFACE CAUSES
#    Input:  dfmea_failure_modes (reused from Step 6) + noise_factors
#    Output: for each (mode × noise_factor) → one interface-mechanism cause
# ═══════════════════════════════════════════════════════════════════════════════

class InterfaceCauseRequest(BaseModel):
    from_element:       str
    to_element:         str
    connection_type:    str
    nominal_transfer:   str
    dfmea_failure_mode: str                   # reused from DFMEA, not generated here
    focus_function:     str
    noise_factors:      dict[str, list[str]]  # {category: [factors]}


class InterfaceCauseItem(BaseModel):
    cause:          str
    noise_category: str
    noise_factor:   str


def generate_interface_causes(req: InterfaceCauseRequest) -> list[InterfaceCauseItem]:
    conn_desc = CONN_DESCRIPTIONS.get(req.connection_type, req.connection_type)
    causes = []

    for category, factors in req.noise_factors.items():
        for factor in factors:
            if not factor.strip():
                continue

            prompt = f"""TASK: Generate an Interface Failure Cause.

CONTEXT
-------
Interface FROM  : {req.from_element}
Interface TO    : {req.to_element}
Connection type : {conn_desc}
What is transferred: {req.nominal_transfer}
Noise factor    : {category}: {factor}

DFMEA failure mode being caused: "{req.dfmea_failure_mode}"

Your job: explain how the INTERFACE MECHANISM itself degrades under this noise
factor and produces the failure mode above in the connected system.

WHAT AN INTERFACE CAUSE IS
--------------------------
A degradation in the interface mechanism — connector, coupling, joint, cable,
pipe, seal, or protocol layer. NOT a failure inside {req.from_element} or
{req.to_element} themselves.

Examples by connection type:
  P: fretting corrosion at spline contact reduces torque transfer capacity
     fastener self-loosening from vibration causes joint separation
  E: increased contact resistance at terminal reduces conducted power
     hydraulic seal swelling from heat restricts fluid flow
  I: EMI bit-error rate increase corrupts sensor signal value
     connector micro-fretting causes intermittent signal dropout
  M: filter clogging from particulate reduces fluid flow rate
     seal cracking from thermal cycling allows fluid cross-contamination

RULES
-----
- Cause must be IN the interface mechanism, triggered by: {factor}
- Must lead to: "{req.dfmea_failure_mode}"
- Do NOT describe failure inside {req.from_element} or {req.to_element}
- One sentence. Specific and physically measurable.

OUTPUT: One cause sentence, or exactly NONE if not realistic.
"""
            raw = llm.generate(prompt, max_tokens=200).strip()
            if not raw or raw.upper() == "NONE":
                continue
            line = next((l for l in raw.split("\n") if l.strip()), raw)
            causes.append(InterfaceCauseItem(
                cause=_parse_bullet(line),
                noise_category=category,
                noise_factor=factor,
            ))

    return causes


class InterfaceCauseBulkRequest(BaseModel):
    from_element:        str
    to_element:          str
    connection_type:     str
    nominal_transfer:    str
    focus_function:      str
    dfmea_failure_modes: list[str]            # from DFMEA Step 6
    noise_factors:       dict[str, list[str]]


@router.post("/interface-causes/bulk")
def interface_causes_bulk(req: InterfaceCauseBulkRequest):
    """
    Generate interface causes for each DFMEA failure mode × noise factor.

    Response:
    {
      "groups": [
        {
          "failure_mode": "<same text as DFMEA mode>",
          "causes": [{ "cause", "noise_category", "noise_factor" }, ...]
        }
      ]
    }
    """
    results = []
    for mode in req.dfmea_failure_modes:
        causes = generate_interface_causes(InterfaceCauseRequest(
            from_element=req.from_element,
            to_element=req.to_element,
            connection_type=req.connection_type,
            nominal_transfer=req.nominal_transfer,
            dfmea_failure_mode=mode,
            focus_function=req.focus_function,
            noise_factors=req.noise_factors,
        ))
        results.append({
            "failure_mode": mode,
            "causes":       [c.dict() for c in causes],
        })
    return {"groups": results}


# ═══════════════════════════════════════════════════════════════════════════════
# 2. INTERFACE EFFECTS — bidirectional
# ═══════════════════════════════════════════════════════════════════════════════

class InterfaceEffectRow(BaseModel):
    row_id:           str
    from_element:     str
    to_element:       str
    connection_type:  str
    nominal_transfer: str
    failure_mode:     str   # DFMEA failure mode (reused)
    interface_cause:  str   # the specific interface cause generated above


class InterfaceEffectsBulkRequest(BaseModel):
    rows: list[InterfaceEffectRow]


def generate_interface_effects(row: InterfaceEffectRow) -> dict:
    conn_desc = CONN_DESCRIPTIONS.get(row.connection_type, row.connection_type)
    prompt = f"""TASK: Generate Interface Failure Effects.

Interface FROM  : {row.from_element}
Interface TO    : {row.to_element}
Connection type : {conn_desc}
Transferred     : {row.nominal_transfer}
Failure mode    : "{row.failure_mode}"
Interface cause : "{row.interface_cause}"

Generate TWO effects:

1. EFFECT ON RECEIVING ELEMENT ({row.to_element}):
   What function is lost or degraded because of this interface cause?

2. EFFECT ON SENDING ELEMENT ({row.from_element}):
   What happens due to changed load, back-pressure, or loss of feedback?
   Use "No significant effect on sending element" if truly none.

Each effect is ONE sentence describing functional impact.

OUTPUT: Valid JSON only, no markdown.
{{
  "effect_on_receiver": "<one sentence>",
  "effect_on_sender":   "<one sentence>"
}}
"""
    raw = llm.generate(prompt, max_tokens=300)
    try:
        return json.loads(_strip_json(raw))
    except Exception:
        return {"effect_on_receiver": raw[:200].strip(), "effect_on_sender": "Could not parse"}


@router.post("/interface-effects/bulk")
def interface_effects_bulk(req: InterfaceEffectsBulkRequest):
    results = []
    for row in req.rows:
        effects = generate_interface_effects(row)
        results.append({
            "row_id":             row.row_id,
            "effect_on_receiver": effects.get("effect_on_receiver", ""),
            "effect_on_sender":   effects.get("effect_on_sender",   ""),
        })
    return {"results": results}


# ═══════════════════════════════════════════════════════════════════════════════
# 3. INTERFACE SEVERITY
# ═══════════════════════════════════════════════════════════════════════════════

SEVERITY_RUBRIC = """
S=10 Hazardous without warning. Safety risk.
S=9  Hazardous with warning. Safety risk.
S=8  Primary vehicle function completely lost.
S=7  Primary function degraded, partially operational.
S=6  Secondary function completely lost.
S=5  Secondary function degraded.
S=4  Noticeable NVH/appearance/performance issue.
S=3  Minor effect, ~50% customers notice.
S=2  Minor. <25% customers notice.
S=1  No discernible effect.
""".strip()


class InterfaceSeverityRow(BaseModel):
    row_id:             str
    to_element:         str
    effect_on_receiver: str


class InterfaceSeverityBulkRequest(BaseModel):
    rows: list[InterfaceSeverityRow]


@router.post("/interface-severity/bulk")
def interface_severity_bulk(req: InterfaceSeverityBulkRequest):
    results = []
    for row in req.rows:
        if not row.effect_on_receiver.strip():
            results.append({"row_id": row.row_id, "severity_rank": 5, "reason": "No effect provided"})
            continue
        prompt = f"""Rate severity of this interface failure effect.

Receiving element: {row.to_element}
Effect: "{row.effect_on_receiver}"

{SEVERITY_RUBRIC}

Output ONLY valid JSON, no markdown.
{{"severity_rank": <1-10>, "reason": "<one sentence>"}}
"""
        raw = llm.generate(prompt, max_tokens=150)
        try:
            parsed = json.loads(_strip_json(raw))
            rank = max(1, min(10, int(parsed.get("severity_rank", 5))))
            results.append({"row_id": row.row_id, "severity_rank": rank, "reason": parsed.get("reason", "")})
        except Exception:
            m = re.search(r'"severity_rank"\s*:\s*(\d+)', raw)
            results.append({"row_id": row.row_id, "severity_rank": int(m.group(1)) if m else 5, "reason": raw[:150]})
    return {"results": results}
