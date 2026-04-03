"""
dfmea_import_parser.py
======================
Parses an AIAG-VDA DFMEA xlsx file (Ashok Leyland / IIT Madras format) and
produces two structured payloads:

  Case 1 — New conditions / use case
    Same design, different operating environment.
    Keeps:   elements, functions, failure modes, failure causes (design mechanisms only)
    Strips:  noise-condition causes (overloading, salt pan, temp, road type …)
    Outputs: wizard-ready JSON + noise_factors stub for user to fill in

  Case 2 — Modified design
    Same environment, changed component(s).
    Keeps:   elements, functions, higher-level effects, severity ratings
    Strips:  specific failure causes (those belong to the old design)
    Outputs: wizard-ready JSON retaining modes + effects as context for LLM re-generation

Column map (header is row 11 of the DFMEA Worksheet, data from row 12):
  Col 0  — Next Higher Level element
  Col 1  — Focus Element
  Col 2  — Next Lower Level element
  Col 3  — Next Higher Level Function & Requirement
  Col 4  — Focus Element Function & Requirement
  Col 5  — Next Lower Level Function & Requirement
  Col 6  — Failure Effect (to higher level)
  Col 7  — Severity (S)
  Col 8  — Classification
  Col 9  — Failure Mode (FM)
  Col 10 — Failure Cause (FC)
  Col 11 — Current Prevention Controls
  Col 12 — Occurrence (O)
  Col 13 — Current Detection Controls
  Col 14 — Detection (D)
  Col 15 — AP
"""

import re
import json
from pathlib import Path
from collections import defaultdict
from typing import Any

import pandas as pd


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN INDICES
# ─────────────────────────────────────────────────────────────────────────────

C_HIGHER_EL   = 0
C_FOCUS_EL    = 1
C_LOWER_EL    = 2
C_HIGHER_FN   = 3
C_FOCUS_FN    = 4
C_LOWER_FN    = 5
C_FE          = 6   # Failure Effect
C_SEV         = 7   # Severity
C_CLASS       = 8
C_FM          = 9   # Failure Mode
C_FC          = 10  # Failure Cause
C_PC          = 11  # Prevention Controls
C_OCC         = 12  # Occurrence
C_DC          = 13  # Detection Controls
C_DET         = 14  # Detection
C_AP          = 15  # Action Priority


# ─────────────────────────────────────────────────────────────────────────────
# NOISE-CONDITION PATTERNS
# These appear in failure causes when the cause is driven by a noise factor
# (use-case / environment) rather than a design deficiency.
# ─────────────────────────────────────────────────────────────────────────────

NOISE_PATTERNS = [
    # Overload
    r"overload",
    r"over.?loading",
    r"excess.*load",
    # Temperature
    r"\+\s*\d+\s*deg",
    r"-\s*\d+\s*deg",
    r"high temperature",
    r"low temperature",
    r"molten tar",
    r"thermal",
    # Road / terrain
    r"mining track",
    r"part.?paved",
    r"river sand",
    r"salt pan",
    r"corrosive environment",
    r"dusty",
    r"wading",
    r"water ingress",
    r"water wad",
    r"paved road",
    # Generic environmental
    r"operating in a",
    r"operating on a",
    r"operating on mining",
    r"extreme loads operating",
]

_NOISE_RE = re.compile("|".join(NOISE_PATTERNS), re.IGNORECASE)


def _is_noise_driven(cause: str) -> bool:
    """Return True if this failure cause is driven by a noise/environment condition."""
    return bool(_NOISE_RE.search(str(cause)))


def _extract_noise_label(cause: str) -> str | None:
    """
    Try to pull a short noise label from a cause string.
    e.g. "due to operating with overloading (150%)" → "Customer Usage: Overloading 150%"
         "due to operating in a corrosive environment (Salt Pan)" → "External Environment: Salt Pan"
    """
    cause = str(cause)
    m = re.search(r"due to (.+?)(?:\s*\.|$|\n)", cause, re.IGNORECASE)
    if not m:
        return None
    raw = m.group(1).strip().rstrip("- ").strip()

    # Map to P-diagram category
    cat = "Customer Usage"
    if re.search(r"temperature|thermal|deg|molten|tar", raw, re.I):
        cat = "External Environment"
    elif re.search(r"salt|corrosive|wading|water|sand|dust|track|paved|mining", raw, re.I):
        cat = "Customer Usage"
    elif re.search(r"vibration|wear|fatigue|age|life", raw, re.I):
        cat = "Change Over Time"

    return f"{cat}: {raw[:80]}"


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _clean(v: Any) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()


def _uid():
    import uuid
    return str(uuid.uuid4())[:8]


def _normalise_element_name(name: str) -> str:
    """Normalise case variations: 'Axle housing' / 'Axle Housing' → 'Axle Housing'."""
    return name.strip().title()


# ─────────────────────────────────────────────────────────────────────────────
# SHEET READERS
# ─────────────────────────────────────────────────────────────────────────────

def read_dfmea_rows(path: str) -> pd.DataFrame:
    """
    Read the DFMEA Worksheet sheet.
    Row 11 (0-indexed) is the column header; data starts at row 12.
    Returns a clean DataFrame with named columns.
    """
    raw = pd.read_excel(path, sheet_name="DFMEA Worksheet", header=None)

    COL_NAMES = {
        C_HIGHER_EL: "higher_element",
        C_FOCUS_EL:  "focus_element",
        C_LOWER_EL:  "lower_element",
        C_HIGHER_FN: "higher_fn",
        C_FOCUS_FN:  "focus_fn",
        C_LOWER_FN:  "lower_fn",
        C_FE:        "failure_effect",
        C_SEV:       "severity",
        C_CLASS:     "classification",
        C_FM:        "failure_mode",
        C_FC:        "failure_cause",
        C_PC:        "prevention_controls",
        C_OCC:       "occurrence",
        C_DC:        "detection_controls",
        C_DET:       "detection",
        C_AP:        "ap",
    }

    df = raw.iloc[12:].reset_index(drop=True)
    df.columns = range(df.shape[1])

    # Keep only columns we need and rename them
    df = df[[c for c in COL_NAMES]].rename(columns=COL_NAMES)

    # Drop rows with no focus element
    df = df[df["focus_element"].notna() & (df["focus_element"] != "")]

    # Clean all string columns
    for col in df.columns:
        df[col] = df[col].apply(_clean)

    # Normalise element name casing
    for col in ("higher_element", "focus_element", "lower_element"):
        df[col] = df[col].apply(_normalise_element_name)

    return df.reset_index(drop=True)


def read_p_diagram(path: str) -> dict:
    """
    Read noise factors from the P-Diagram sheet.
    Returns { category: [factor, ...] } using the 5 standard column headers.
    """
    raw = pd.read_excel(path, sheet_name="P-Diagram", header=None)

    CAT_MAP = {
        "Piece to Piece Variation": "pieceTopiece",
        "Change Over Time":         "changeOverTime",
        "Customer Usage":           "customerUsage",
        "External Environment":     "externalEnvironment",
        "System Interactions":      "systemInteractions",
    }

    # Row 1 (0-indexed) contains the column headers
    header_row = raw.iloc[1].tolist()
    col_to_cat: dict[int, str] = {}
    for ci, val in enumerate(header_row):
        v = _clean(val)
        if v in CAT_MAP:
            col_to_cat[ci] = CAT_MAP[v]

    noise: dict[str, list[str]] = {v: [] for v in CAT_MAP.values()}

    # Rows 2..14 contain noise factor values (before the signal flow section)
    for ri in range(2, 15):
        row = raw.iloc[ri].tolist()
        for ci, cat_key in col_to_cat.items():
            v = _clean(row[ci]) if ci < len(row) else ""
            if v:
                noise[cat_key].append(v)

    return noise


# ─────────────────────────────────────────────────────────────────────────────
# CORE PARSER
# ─────────────────────────────────────────────────────────────────────────────

def parse_dfmea(path: str) -> dict:
    """
    Full parse of the DFMEA xlsx.
    Returns a dict containing:
      - metadata
      - elements: { higher, focus, lower[] }
      - functions: { higher_fns[], focus_fns[], lower_fns: {element: [fn, ...]} }
      - rows: list of fully-parsed row dicts
      - noise_from_p_diagram: { category: [factor, ...] }
      - noise_from_causes: set of strings inferred from failure causes
    """
    df = read_dfmea_rows(path)
    p_noise = read_p_diagram(path)

    # ── Elements ──────────────────────────────────────────────────────────────
    higher_el = df["higher_element"].dropna().iloc[0] if not df["higher_element"].dropna().empty else ""
    focus_el  = df["focus_element"].dropna().iloc[0]  if not df["focus_element"].dropna().empty  else ""
    lower_els = sorted(df["lower_element"].dropna().unique().tolist())

    # ── Functions — deduplicate per element ───────────────────────────────────
    higher_fns = sorted(set(df["higher_fn"].dropna().tolist()))
    focus_fns  = sorted(set(df["focus_fn"].dropna().tolist()))

    lower_fns: dict[str, list[str]] = defaultdict(set)
    for _, row in df.iterrows():
        el = row["lower_element"]
        fn = row["lower_fn"]
        if el and fn:
            lower_fns[el].add(fn)
    lower_fns_clean = {el: sorted(fns) for el, fns in lower_fns.items()}

    # ── Rows ──────────────────────────────────────────────────────────────────
    rows = []
    noise_from_causes: set[str] = set()

    for _, row in df.iterrows():
        cause = row["failure_cause"]
        noise_driven = _is_noise_driven(cause)

        noise_label = None
        if noise_driven:
            noise_label = _extract_noise_label(cause)
            if noise_label:
                noise_from_causes.add(noise_label)

        rows.append({
            "id":                  _uid(),
            "higher_element":      row["higher_element"],
            "focus_element":       row["focus_element"],
            "lower_element":       row["lower_element"],
            "higher_fn":           row["higher_fn"],
            "focus_fn":            row["focus_fn"],
            "lower_fn":            row["lower_fn"],
            "failure_effect":      row["failure_effect"],
            "severity":            _parse_int(row["severity"]),
            "classification":      row["classification"],
            "failure_mode":        row["failure_mode"],
            "failure_cause":       cause,
            "prevention_controls": row["prevention_controls"],
            "occurrence":          _parse_int(row["occurrence"]),
            "detection_controls":  row["detection_controls"],
            "detection":           _parse_int(row["detection"]),
            "ap":                  row["ap"],
            "noise_driven":        noise_driven,
            "noise_label":         noise_label,
        })

    return {
        "metadata": {
            "source_file": Path(path).name,
            "higher_element": higher_el,
            "focus_element":  focus_el,
            "lower_elements": lower_els,
            "total_rows":     len(rows),
        },
        "elements": {
            "higher": higher_el,
            "focus":  focus_el,
            "lower":  lower_els,
        },
        "functions": {
            "higher_fns": higher_fns,
            "focus_fns":  focus_fns,
            "lower_fns":  lower_fns_clean,
        },
        "rows": rows,
        "noise_from_p_diagram": p_noise,
        "noise_from_causes":    sorted(noise_from_causes),
    }


def _parse_int(v: str) -> int | None:
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# CASE 1 — New operating conditions / use case
# Same design, different noise factors.
#
# Strategy:
#   - Keep all elements and functions unchanged (the hardware is the same)
#   - Keep all failure modes (what can break is the same)
#   - Keep design-mechanism causes only (cracks, fatigue, wear — not env-driven)
#   - Strip noise-driven causes and present them as a "noise stub" for the user
#     to replace with their own operating conditions
#   - Carry forward S ratings (severity depends on system, not environment)
#   - Clear O and D ratings (those depend on how often the new env causes it)
#   - Output is wizard-ready: populates Steps 0–6, leaves Steps 7–8 empty
# ─────────────────────────────────────────────────────────────────────────────

def build_case1_new_conditions(parsed: dict) -> dict:
    """
    Case 1: Same design, new operating conditions.
    Returns wizard-ready payload.
    """
    rows = parsed["rows"]

    # ── Deduplicate failure modes per focus function ──────────────────────────
    # Key: (focus_fn, failure_mode) → keep the row with highest severity
    mode_map: dict[tuple, dict] = {}
    for row in rows:
        key = (row["focus_fn"], row["failure_mode"])
        if key not in mode_map or (row["severity"] or 0) > (mode_map[key]["severity"] or 0):
            mode_map[key] = row

    # ── Split causes: design-mechanism vs noise-driven ────────────────────────
    # Group by (focus_fn, failure_mode, lower_element) and collect design causes
    design_causes_by_mode: dict[tuple, list[dict]] = defaultdict(list)
    noise_causes_by_mode:  dict[tuple, list[str]]  = defaultdict(list)

    for row in rows:
        key = (row["focus_fn"], row["failure_mode"])
        if not row["noise_driven"]:
            design_causes_by_mode[key].append({
                "cause":               row["failure_cause"],
                "lower_element":       row["lower_element"],
                "lower_fn":            row["lower_fn"],
                "prevention_controls": row["prevention_controls"],
                "detection_controls":  row["detection_controls"],
                "severity":            row["severity"],
                # O and D cleared — they belong to the old environment
                "occurrence":          None,
                "detection":           None,
                "ap":                  None,
            })
        elif row["noise_label"]:
            if row["noise_label"] not in noise_causes_by_mode[key]:
                noise_causes_by_mode[key].append(row["noise_label"])

    # ── Unique noise labels found in this DFMEA (for the user to replace) ─────
    all_noise_labels = sorted(set(parsed["noise_from_causes"]))

    # ── Build wizard payload ──────────────────────────────────────────────────
    # Elements are unchanged
    wizard_elements = {
        "higher": [{"name": parsed["elements"]["higher"], "level": "higher"}],
        "focus":  [{"name": parsed["elements"]["focus"],  "level": "focus"}],
        "lower":  [{"name": el, "level": "lower"} for el in parsed["elements"]["lower"]],
    }

    # Functions: deduplicate across rows
    wizard_functions = []
    seen_fns: set[tuple] = set()

    for fn in parsed["functions"]["higher_fns"]:
        k = (parsed["elements"]["higher"], fn)
        if k not in seen_fns:
            wizard_functions.append({"element": parsed["elements"]["higher"], "function": fn, "level": "higher"})
            seen_fns.add(k)

    for fn in parsed["functions"]["focus_fns"]:
        k = (parsed["elements"]["focus"], fn)
        if k not in seen_fns:
            wizard_functions.append({"element": parsed["elements"]["focus"], "function": fn, "level": "focus"})
            seen_fns.add(k)

    for el, fns in parsed["functions"]["lower_fns"].items():
        for fn in fns:
            k = (el, fn)
            if k not in seen_fns:
                wizard_functions.append({"element": el, "function": fn, "level": "lower"})
                seen_fns.add(k)

    # Failure modes and their surviving causes
    wizard_modes = []
    for (focus_fn, failure_mode), row in mode_map.items():
        key = (focus_fn, failure_mode)
        design_causes = design_causes_by_mode.get(key, [])
        wizard_modes.append({
            "focus_fn":      focus_fn,
            "failure_mode":  failure_mode,
            "failure_effect": row["failure_effect"],
            "severity":      row["severity"],
            "design_causes": design_causes,  # ← kept: design-mechanism causes
            # Noise-driven causes stripped; user replaces with new env causes
            "stripped_noise_causes": noise_causes_by_mode.get(key, []),
        })

    # Noise stub: present original P-diagram noise + inferred noise labels
    # so the user can replace with their new operating environment
    noise_stub = {
        "from_p_diagram":         parsed["noise_from_p_diagram"],
        "inferred_from_causes":   all_noise_labels,
        "instructions": (
            "These noise factors came from the original DFMEA's operating environment. "
            "Replace them with your new operating conditions in the P-Diagram step. "
            "Noise-driven failure causes have been removed and will be re-generated "
            "from your new noise factors."
        ),
    }

    return {
        "case": "new_conditions",
        "description": "Same design, new operating environment. "
                       "Elements and functions preserved. Noise-driven causes stripped. "
                       "O/D ratings cleared. Fill in new noise factors then re-generate causes.",
        "wizard_payload": {
            "elements":          wizard_elements,
            "functions":         wizard_functions,
            "failure_modes":     wizard_modes,
            "noise_stub":        noise_stub,
            # Steps pre-populated:  Elements, Functions, Modes (partial)
            # Steps for user:       P-Diagram (new noise), Failure Causes, Risk Rating
        },
        "stats": {
            "elements":                len(wizard_elements["lower"]) + 2,
            "functions":               len(wizard_functions),
            "failure_modes":           len(wizard_modes),
            "design_cause_rows_kept":  sum(len(v) for v in design_causes_by_mode.values()),
            "noise_cause_rows_stripped": sum(1 for r in rows if r["noise_driven"]),
            "unique_noise_labels":     len(all_noise_labels),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# CASE 2 — Modified design
# Same operating environment, changed component(s).
#
# Strategy:
#   - Keep all elements and functions (user marks which are modified)
#   - Keep failure modes (the functional requirements don't change)
#   - Keep failure effects AND severity (system-level consequences unchanged)
#   - Keep noise-driven causes (env is the same) but mark them "retain"
#   - Strip design-mechanism causes for modified elements (old design, replaced)
#   - Keep design-mechanism causes for unmodified elements
#   - Output includes a "modified_elements" field for user to mark
#   - LLM re-generates causes only for modified elements
# ─────────────────────────────────────────────────────────────────────────────

def build_case2_modified_design(parsed: dict, modified_elements: list[str] | None = None) -> dict:
    """
    Case 2: Same environment, modified component(s).

    modified_elements: list of lower element names whose design has changed.
    If None, all lower elements are treated as potentially modified (user marks them).

    Returns wizard-ready payload.
    """
    rows = parsed["rows"]
    modified_set = set(modified_elements or [])

    # ── Group causes by (focus_fn, failure_mode, lower_element) ──────────────
    cause_groups: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        key = (row["focus_fn"], row["failure_mode"], row["lower_element"])
        cause_groups[key].append(row)

    # ── For each cause group decide: retain or clear ──────────────────────────
    # Rules:
    #   noise-driven cause  → always retain (env unchanged)
    #   design cause for unmodified element → retain with S/O/D
    #   design cause for modified element   → strip (new design, re-generate)
    #
    wizard_modes: list[dict] = []
    seen_modes: set[tuple] = set()

    for (focus_fn, failure_mode, lower_el), group_rows in cause_groups.items():
        mk = (focus_fn, failure_mode)
        is_modified = (not modified_set) or (lower_el in modified_set)

        retained_causes = []
        stripped_causes = []

        for row in group_rows:
            if row["noise_driven"]:
                # Noise-driven: always keep with full ratings
                retained_causes.append({
                    "cause":               row["failure_cause"],
                    "lower_element":       row["lower_element"],
                    "lower_fn":            row["lower_fn"],
                    "noise_label":         row["noise_label"],
                    "noise_driven":        True,
                    "prevention_controls": row["prevention_controls"],
                    "detection_controls":  row["detection_controls"],
                    "severity":            row["severity"],
                    "occurrence":          row["occurrence"],
                    "detection":           row["detection"],
                    "ap":                  row["ap"],
                    "source":              "retained_from_original",
                })
            elif is_modified:
                # Design cause for modified element → strip
                stripped_causes.append({
                    "cause":         row["failure_cause"],
                    "lower_element": row["lower_element"],
                    "source":        "stripped_design_modified",
                })
            else:
                # Design cause for unmodified element → retain with ratings
                retained_causes.append({
                    "cause":               row["failure_cause"],
                    "lower_element":       row["lower_element"],
                    "lower_fn":            row["lower_fn"],
                    "noise_driven":        False,
                    "prevention_controls": row["prevention_controls"],
                    "detection_controls":  row["detection_controls"],
                    "severity":            row["severity"],
                    "occurrence":          row["occurrence"],
                    "detection":           row["detection"],
                    "ap":                  row["ap"],
                    "source":              "retained_from_original",
                })

        if mk not in seen_modes:
            seen_modes.add(mk)
            representative = group_rows[0]
            wizard_modes.append({
                "focus_fn":           focus_fn,
                "failure_mode":       failure_mode,
                "failure_effect":     representative["failure_effect"],
                # Severity retained — system consequences same regardless of design change
                "severity":           representative["severity"],
                "lower_element":      lower_el,
                "lower_fn":           representative["lower_fn"],
                "retained_causes":    retained_causes,
                "stripped_causes":    stripped_causes,
                "needs_regen":        bool(stripped_causes),
                "modified_element":   is_modified,
            })

    # ── Elements — same as original ───────────────────────────────────────────
    wizard_elements = {
        "higher": [{"name": parsed["elements"]["higher"], "level": "higher"}],
        "focus":  [{"name": parsed["elements"]["focus"],  "level": "focus"}],
        "lower":  [
            {
                "name":     el,
                "level":    "lower",
                "modified": el in modified_set,
            }
            for el in parsed["elements"]["lower"]
        ],
    }

    # ── Functions: all retained (requirements don't change with design mod) ───
    wizard_functions = []
    seen_fns: set[tuple] = set()
    for fn in parsed["functions"]["higher_fns"]:
        k = (parsed["elements"]["higher"], fn)
        if k not in seen_fns:
            wizard_functions.append({"element": parsed["elements"]["higher"], "function": fn, "level": "higher"})
            seen_fns.add(k)
    for fn in parsed["functions"]["focus_fns"]:
        k = (parsed["elements"]["focus"], fn)
        if k not in seen_fns:
            wizard_functions.append({"element": parsed["elements"]["focus"], "function": fn, "level": "focus"})
            seen_fns.add(k)
    for el, fns in parsed["functions"]["lower_fns"].items():
        for fn in fns:
            k = (el, fn)
            if k not in seen_fns:
                wizard_functions.append({
                    "element":  el,
                    "function": fn,
                    "level":    "lower",
                    "modified": el in modified_set,
                })
                seen_fns.add(k)

    # Noise factors: fully retained from original P-Diagram
    noise_retained = parsed["noise_from_p_diagram"]

    total_retained = sum(len(m["retained_causes"]) for m in wizard_modes)
    total_stripped = sum(len(m["stripped_causes"]) for m in wizard_modes)
    modes_needing_regen = sum(1 for m in wizard_modes if m["needs_regen"])

    return {
        "case": "modified_design",
        "description": (
            "Same operating environment, modified component(s). "
            "Noise-driven causes fully retained with original O/D ratings. "
            "Design causes for modified elements stripped (re-generate with LLM). "
            "Severity ratings preserved throughout."
        ),
        "modified_elements": list(modified_set) or "user_to_specify",
        "wizard_payload": {
            "elements":          wizard_elements,
            "functions":         wizard_functions,
            "failure_modes":     wizard_modes,
            "noise_factors":     noise_retained,
            # Steps pre-populated:  Elements, Functions, Modes, Noise (retained)
            # Steps for user:       Re-generate causes for modified elements only
        },
        "stats": {
            "elements":                    len(wizard_elements["lower"]) + 2,
            "functions":                   len(wizard_functions),
            "failure_modes":               len(wizard_modes),
            "cause_rows_retained":         total_retained,
            "cause_rows_stripped":         total_stripped,
            "modes_needing_regen":         modes_needing_regen,
            "modified_elements_specified": bool(modified_set),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY REPORTER
# ─────────────────────────────────────────────────────────────────────────────

def print_summary(parsed: dict, case1: dict, case2: dict) -> None:
    meta = parsed["metadata"]
    print("=" * 70)
    print(f"  DFMEA IMPORT SUMMARY — {meta['source_file']}")
    print("=" * 70)
    print(f"  Higher element : {meta['higher_element']}")
    print(f"  Focus element  : {meta['focus_element']}")
    print(f"  Lower elements : {len(meta['lower_elements'])}")
    for el in meta['lower_elements']:
        print(f"    · {el}")
    print(f"  Total rows     : {meta['total_rows']}")
    print()

    print("  Functions extracted:")
    print(f"    · Focus functions  : {len(parsed['functions']['focus_fns'])}")
    for fn in parsed['functions']['focus_fns']:
        print(f"        – {fn[:80]}")
    print(f"    · Higher functions : {len(parsed['functions']['higher_fns'])}")
    print(f"    · Lower functions  : {sum(len(v) for v in parsed['functions']['lower_fns'].values())}")
    print()

    print("  Noise factors (from P-Diagram):")
    for cat, items in parsed["noise_from_p_diagram"].items():
        if items:
            print(f"    [{cat}]")
            for item in items:
                print(f"        · {item}")
    print()
    print(f"  Noise labels inferred from causes: {len(parsed['noise_from_causes'])}")
    for n in parsed['noise_from_causes'][:8]:
        print(f"    · {n}")
    if len(parsed['noise_from_causes']) > 8:
        print(f"    … and {len(parsed['noise_from_causes']) - 8} more")
    print()

    s1 = case1["stats"]
    print("─" * 70)
    print("  CASE 1 — New operating conditions")
    print(f"    Failure modes kept           : {s1['failure_modes']}")
    print(f"    Design causes retained       : {s1['design_cause_rows_kept']}")
    print(f"    Noise-driven causes stripped : {s1['noise_cause_rows_stripped']}")
    print(f"    Unique noise labels to replace: {s1['unique_noise_labels']}")
    print()

    s2 = case2["stats"]
    print("─" * 70)
    print("  CASE 2 — Modified design (no elements marked modified yet)")
    print(f"    Failure modes              : {s2['failure_modes']}")
    print(f"    Causes retained            : {s2['cause_rows_retained']}")
    print(f"    Causes stripped            : {s2['cause_rows_stripped']}")
    print(f"    Modes needing re-generation: {s2['modes_needing_regen']}")
    print("=" * 70)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else \
        "/mnt/user-data/uploads/1-Chassis_System-Axle_System_DFMEA_v4_Final__3_.xlsx"

    print(f"Parsing: {path}")
    parsed = parse_dfmea(path)

    # Case 1: all noise-driven causes stripped
    case1 = build_case1_new_conditions(parsed)

    # Case 2: no elements marked modified yet (user will mark them in the UI)
    case2 = build_case2_modified_design(parsed, modified_elements=None)

    print_summary(parsed, case1, case2)

    # Write JSON outputs
    out_dir = Path("/mnt/user-data/outputs")
    out_dir.mkdir(exist_ok=True)

    (out_dir / "dfmea_parsed_full.json").write_text(
        json.dumps(parsed, indent=2, default=str), encoding="utf-8"
    )
    (out_dir / "dfmea_import_case1_new_conditions.json").write_text(
        json.dumps(case1, indent=2, default=str), encoding="utf-8"
    )
    (out_dir / "dfmea_import_case2_modified_design.json").write_text(
        json.dumps(case2, indent=2, default=str), encoding="utf-8"
    )

    print(f"\nOutputs written to {out_dir}:")
    print("  · dfmea_parsed_full.json")
    print("  · dfmea_import_case1_new_conditions.json")
    print("  · dfmea_import_case2_modified_design.json")
