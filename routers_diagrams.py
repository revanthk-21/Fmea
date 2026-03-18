"""
routers/diagrams.py
POST /api/dfmea/generate-diagrams

Uses LLM to auto-generate structured content for B-Diagram and P-Diagram
from the wizard inputs (focus element, lower/higher elements, noise factors).

Returns JSON matching the BDiagramData and PDiagramData TypeScript types.
"""

from fastapi import APIRouter
from pydantic import BaseModel
import json
import re
from llm_client import llm

router = APIRouter()


# ── Request model ─────────────────────────────────────────────────────────────

class DiagramRequest(BaseModel):
    focus_element:   str
    lower_elements:  list[str]
    higher_elements: list[str]
    noise_factors:   dict[str, list[str]]    # {category: [factors]}


# ── LLM prompt helpers ────────────────────────────────────────────────────────

def _strip_json(text: str) -> str:
    """Remove markdown fences if present."""
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _generate_b_diagram(req: DiagramRequest) -> dict:
    lower_list  = ", ".join(req.lower_elements)  or "none"
    higher_list = ", ".join(req.higher_elements) or "none"

    noise_summary = "; ".join(
        f"{cat}: {', '.join(factors[:3])}"
        for cat, factors in req.noise_factors.items()
        if factors
    ) or "none"

    prompt = f"""You are a DFMEA expert following AIAG-VDA 2019 methodology.

Generate the content for a B-Diagram (Boundary Diagram) for the focus element described below.

Focus element: {req.focus_element}
Lower-level elements (interface to focus from below): {lower_list}
Higher-level elements (interface to focus from above): {higher_list}
Known noise factors: {noise_summary}

TASK:
For each lower and higher element, determine the dominant interaction types:
  P = Physical (welded, bolted, clamped, fits, clearances)
  E = Energy (torque, heat, current, vibration)
  I = Information (CAN signals, sensor signals, RF signals)
  M = Material (cooling fluid, exhaust gases, brake fluid, wear)

Also provide:
- requirements: 5-7 short requirement category names (e.g. LEGAL, SAFETY, PRODUCT SPEC, STANDARDS, VEHICLE OPERATIONS, SERVICE)
- noiseFactors: 4-8 noise factor categories shown in the bottom bar (e.g. ROAD INPUTS, ENVIRONMENT, VEHICLE EMC)

RULES:
- Output ONLY valid JSON, no preamble, no markdown fences
- Use exact element names provided
- Each interactionTypes array must contain at least 1 of: "P", "E", "I", "M"

OUTPUT FORMAT:
{{
  "focusElement": "{req.focus_element}",
  "lowerElements": [
    {{"name": "...", "interactionTypes": ["P", "E"]}}
  ],
  "higherElements": [
    {{"name": "...", "interactionTypes": ["P"]}}
  ],
  "requirements": ["LEGAL", "SAFETY", ...],
  "noiseFactors": ["ROAD INPUTS", "ENVIRONMENT", ...]
}}
"""
    raw = llm.generate(prompt, max_tokens=900)
    return json.loads(_strip_json(raw))


def _generate_p_diagram(req: DiagramRequest) -> dict:
    lower_list  = ", ".join(req.lower_elements)  or "none"
    higher_list = ", ".join(req.higher_elements) or "none"

    # Map noise factors to standard P-Diagram categories
    std_cats = {
        "pieceTopiece":        [],
        "changeOverTime":      [],
        "customerUsage":       [],
        "externalEnvironment": [],
        "systemInteractions":  [],
    }

    # Try to map existing noise categories to P-diagram standard categories
    CAT_KEYWORDS = {
        "pieceTopiece":        ["piece", "variation", "tolerance", "manufacturing", "assembly"],
        "changeOverTime":      ["time", "aging", "wear", "degradation", "lifecycle", "over time"],
        "customerUsage":       ["customer", "usage", "operator", "driver", "load", "duty", "road"],
        "externalEnvironment": ["environment", "temperature", "humidity", "weather", "thermal", "moisture", "emc", "emi"],
        "systemInteractions":  ["system", "interaction", "interface", "adjacent", "vehicle"],
    }

    for cat_label, factors in req.noise_factors.items():
        cat_lower = cat_label.lower()
        matched = False
        for std_key, keywords in CAT_KEYWORDS.items():
            if any(kw in cat_lower for kw in keywords):
                std_cats[std_key].extend(factors)
                matched = True
                break
        if not matched:
            std_cats["systemInteractions"].extend(factors)

    noise_json = json.dumps(std_cats)

    prompt = f"""You are a DFMEA expert following AIAG-VDA 2019 methodology.

Generate the content for a P-Diagram (Parameter Diagram) for the system described below.

Focus element / system: {req.focus_element}
Lower-level elements: {lower_list}
Higher-level elements: {higher_list}

Pre-populated noise categories (add more if appropriate):
{noise_json}

TASK: Generate all fields for the P-Diagram.

DEFINITIONS:
- inputs: Physical/energy/information signals entering the system from lower elements or environment
- outputs: Intended system outputs (desired behaviors / functions delivered to higher elements)
- functions: 4-8 core functions of the system (e.g. "Maintain geometry", "Manage forces")
- functionalRequirements: 4-8 specific measurable requirements (e.g. "Carry max load of 5000kg")
- controlFactors: 4-8 design parameters engineer controls (e.g. "Material grade", "Wall thickness")
- nonFunctionalRequirements: 3-6 constraints (e.g. "Weight < 120kg", "IP67 rating")
- unintendedOutputs: 4-8 failure outputs / error states (e.g. "Brake judder", "Fluid leaks")

RULES:
- Output ONLY valid JSON, no preamble, no markdown fences
- Be specific to the {req.focus_element} system
- noiseCategories should contain the pre-populated items PLUS any additional relevant ones

OUTPUT FORMAT:
{{
  "systemName": "{req.focus_element}",
  "noiseCategories": {{
    "pieceTopiece":        [...],
    "changeOverTime":      [...],
    "customerUsage":       [...],
    "externalEnvironment": [...],
    "systemInteractions":  [...]
  }},
  "inputs":  [...],
  "outputs": [...],
  "functions":               [...],
  "functionalRequirements":  [...],
  "controlFactors":          [...],
  "nonFunctionalRequirements": [...],
  "unintendedOutputs":       [...]
}}
"""
    raw = llm.generate(prompt, max_tokens=1200)
    return json.loads(_strip_json(raw))


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/generate-diagrams")
def generate_diagrams(req: DiagramRequest):
    """
    Generate B-Diagram and P-Diagram content using the LLM.
    Returns JSON matching the TypeScript BDiagramData and PDiagramData types.
    """
    b_diagram = _generate_b_diagram(req)
    p_diagram = _generate_p_diagram(req)

    return {
        "bDiagram": b_diagram,
        "pDiagram": p_diagram,
    }
