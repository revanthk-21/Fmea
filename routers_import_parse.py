"""
routers/import_parse.py
=======================
FastAPI router that exposes the universal DFMEA parser for Case 2 and Case 3 imports.

POST /api/dfmea/import/parse
  - Accepts an xlsx file upload
  - Returns a structured payload consumed directly by the frontend wizard

Case 2 — New use case / environmental condition:
  Returns:
    elements (names only), focus_functions, lower_functions, higher_functions,
    noise_factors_from_old_dfmea (so user can see what to replace),
    failure_modes_with_noise_factors (each failure mode tagged with its old noise factor)
    The wizard uses this to: pre-fill elements+functions, show old noise factors,
    let user enter new ones, then re-generate only the noise-affected cause rows.

Case 3 — Design change on existing system:
  Returns:
    elements (names), all functions, noise_factors (retained as-is),
    failure_modes (for reference but not pre-selected — user re-generates from scratch)
    The wizard uses this to: pre-fill elements+functions+noise, leave B-diagram
    empty (just boxes, no connections), leave P-diagram with noise pre-filled,
    user re-draws connections and re-generates causes.
"""

import tempfile
import shutil
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse

# Import the universal parser
import sys
sys.path.append(str(Path(__file__).parent.parent))
from dfmea_universal_parser import parse_dfmea_file

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _uid() -> str:
    import uuid
    return str(uuid.uuid4())[:8]


def _dedup(items: list[str]) -> list[str]:
    seen = set()
    out = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# CASE 2 — New use case / environmental conditions
# Same design, different noise factors.
#
# What we extract:
#   - Element names (lower, focus, higher)
#   - All functions (lower, focus, higher)
#   - For each failure mode: the noise factors that drove its causes
#     This lets the frontend show "these were the old noise factors for this mode"
#     and prompt the user to enter new ones
#   - Old noise factor list (flat, for user to see what changes)
#   - Old failure mode list (for comparison — we keep modes, drop old causes)
# ─────────────────────────────────────────────────────────────────────────────

def build_case2_payload(parsed: dict) -> dict:
    """
    Extract the minimum needed for Case 2 (new operating conditions).
    The wizard will:
      1. Pre-fill Elements and Functions steps from this data
      2. Show old noise factors as "to replace" in P-Diagram step
      3. For each failure mode, show which noise factors it was linked to
         so the user understands what they're replacing
      4. Re-generate causes from scratch using new noise factors the user enters
    """
    # ── Elements ──────────────────────────────────────────────────────────────
    elements = {
        "focus":  parsed["focus_element"],
        "higher": [el["name"] for el in parsed["higher_elements"]],
        "lower":  [el["name"] for el in parsed["lower_elements"]],
    }

    # ── Functions ─────────────────────────────────────────────────────────────
    focus_functions = _dedup(parsed["focus_functions"])

    lower_functions: dict[str, list[str]] = {}
    for el in parsed["lower_elements"]:
        fns = _dedup(el["functions"])
        if fns:
            lower_functions[el["name"]] = fns

    higher_functions: dict[str, list[str]] = {}
    for el in parsed["higher_elements"]:
        fns = _dedup(el["functions"])
        if fns:
            higher_functions[el["name"]] = fns

    # ── Failure modes with their noise factors ────────────────────────────────
    # For each failure mode, collect the distinct noise factors that drove causes
    # This tells the user "this failure mode was triggered by these conditions"
    failure_modes_with_noise: list[dict] = []
    for mode in parsed["failure_modes"]:
        noise_factors_for_mode = _dedup([
            c["noise_factor"]
            for c in mode.get("causes", [])
            if c.get("noise_driven") and c.get("noise_factor")
        ])
        failure_modes_with_noise.append({
            "focus_fn":         mode["focus_fn"],
            "failure_mode":     mode["failure_mode"],
            "failure_effect":   mode["failure_effect"],
            "severity":         mode["severity"],    # retained — same design
            "lower_elements":   _dedup([
                c["lower_element"] for c in mode.get("causes", []) if c.get("lower_element")
            ]),
            "old_noise_factors": noise_factors_for_mode,
            # Causes are intentionally NOT passed — user re-generates with new noise
        })

    # ── Old noise factors (flat list) ─────────────────────────────────────────
    # Show the user what the old environment looked like so they know what to replace
    old_noise_factors_flat = _dedup([
        c["noise_factor"]
        for r in parsed.get("raw_rows", [])
        if r.get("noise_driven") and r.get("noise_factor")
        for c in [r]  # unpacking trick for single dict
    ])

    # Old noise by category (for showing in P-Diagram panel)
    old_noise_by_category = parsed.get("noise_factors", {})

    return {
        "case": "new_use_case",
        "elements":           elements,
        "focus_functions":    focus_functions,
        "lower_functions":    lower_functions,
        "higher_functions":   higher_functions,
        "failure_modes":      failure_modes_with_noise,
        "old_noise_factors":  {
            "flat":        old_noise_factors_flat,
            "by_category": old_noise_by_category,
        },
        # Wizard pre-fills:    Elements, Functions
        # Wizard shows:        Old noise factors panel in P-Diagram step
        # User does:           Enters new noise factors → re-generates causes
        "wizard_instructions": {
            "pre_filled": ["elements", "functions"],
            "user_fills":  ["p_diagram_noise", "connections", "failure_causes", "risk_rating"],
            "note": (
                "Element names and functions are pre-filled from the old DFMEA. "
                "Failure modes are shown for reference with their old noise factors. "
                "Enter new operating conditions in the P-Diagram, then re-generate causes."
            ),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# CASE 3 — Design change on existing system
# Same environment, one or more components changed.
#
# What we extract:
#   - All element names (lower, focus, higher)
#   - All functions
#   - Noise factors (retained exactly — environment unchanged)
#   - Failure modes for reference (so user can see what existed)
#   - B-diagram: empty — just box names, no connections (user re-draws)
#   - P-diagram: pre-filled with existing noise factors
# ─────────────────────────────────────────────────────────────────────────────

def build_case3_payload(parsed: dict) -> dict:
    """
    Extract everything needed for Case 3 (design change).
    The wizard will:
      1. Pre-fill Elements and Functions steps
      2. Pre-fill P-Diagram noise factors (retained from old DFMEA)
      3. Show B-Diagram with just named boxes and NO connections
         (user re-draws connections for the new design)
      4. Leave cause generation empty — user runs it fresh for the new design
    """
    # ── Elements ──────────────────────────────────────────────────────────────
    elements = {
        "focus":  parsed["focus_element"],
        "higher": [el["name"] for el in parsed["higher_elements"]],
        "lower":  [el["name"] for el in parsed["lower_elements"]],
    }

    # ── Functions (all retained) ───────────────────────────────────────────────
    focus_functions = _dedup(parsed["focus_functions"])

    lower_functions: dict[str, list[str]] = {}
    for el in parsed["lower_elements"]:
        fns = _dedup(el["functions"])
        if fns:
            lower_functions[el["name"]] = fns

    higher_functions: dict[str, list[str]] = {}
    for el in parsed["higher_elements"]:
        fns = _dedup(el["functions"])
        if fns:
            higher_functions[el["name"]] = fns

    # ── Noise factors (retained as-is from P-Diagram / cause extraction) ──────
    noise_factors = parsed.get("noise_factors", {})

    # ── Failure modes for reference ───────────────────────────────────────────
    # NOT pre-selected — user re-generates from scratch for new design
    # But shown as reference panel so user can compare old vs new results
    reference_modes = [
        {
            "focus_fn":      mode["focus_fn"],
            "failure_mode":  mode["failure_mode"],
            "failure_effect": mode["failure_effect"],
            "severity":       mode["severity"],
            "lower_elements": _dedup([
                c["lower_element"] for c in mode.get("causes", []) if c.get("lower_element")
            ]),
        }
        for mode in parsed["failure_modes"]
    ]

    # ── S/O/D reference data per element ─────────────────────────────────────
    # User can compare old ratings against new once they generate
    sod_reference = parsed.get("sod_by_element", {})

    return {
        "case": "design_change",
        "elements":            elements,
        "focus_functions":     focus_functions,
        "lower_functions":     lower_functions,
        "higher_functions":    higher_functions,
        "noise_factors":       noise_factors,   # pre-fills P-Diagram
        "reference_modes":     reference_modes, # shown as reference panel only
        "sod_reference":       sod_reference,
        # Wizard pre-fills:  Elements, Functions, P-Diagram noise
        # Wizard shows:      B-Diagram with named boxes but NO connections
        # User does:         Re-draw connections, re-generate causes, re-rate
        "wizard_instructions": {
            "pre_filled": ["elements", "functions", "p_diagram_noise"],
            "user_fills":  ["b_diagram_connections", "connections", "failure_causes", "risk_rating"],
            "note": (
                "Elements and functions are pre-filled. "
                "Noise factors are retained from the original environment. "
                "The B-Diagram shows element boxes only — re-draw connections for the new design. "
                "Re-generate causes and risk ratings for the changed components."
            ),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/import/parse")
async def import_parse(
    file:        UploadFile = File(...),
    case:        str        = Form("new_use_case"),  # "new_use_case" | "design_change"
    sheet_name:  str        = Form(""),
):
    """
    Parse an uploaded DFMEA xlsx file and return a wizard-ready payload.

    case = "new_use_case"  → Case 2: same design, new environment
    case = "design_change" → Case 3: same environment, modified design
    """
    # Save upload to a temp file
    suffix = Path(file.filename or "upload.xlsx").suffix or ".xlsx"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        parsed = parse_dfmea_file(tmp_path, sheet_name or None)
    except Exception as e:
        return JSONResponse(status_code=422, content={"error": str(e)})
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if case == "design_change":
        payload = build_case3_payload(parsed)
    else:
        payload = build_case2_payload(parsed)

    return payload
