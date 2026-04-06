"""
dfmea_universal_parser.py
=========================
Universal DFMEA xlsx parser.

Supports two formats automatically detected by header fingerprinting:

  FORMAT A — AIAG-VDA 2019  (IIT Madras / Ashok Leyland new format)
    Explicit higher / focus / lower element columns.
    Function columns present for all three levels.
    LLM used for: noise factor classification from cause text.

  FORMAT B — Legacy Ford/GM/Chrysler  (Ashok Leyland production format, image)
    Single "Item / Function" column — focus system + numbered sub-items.
    "Requirement" column = function statement.
    No higher-level element column.
    Cause text contains numbered sub-component references (1.1.1.1).
    LLM used for:
      - Infer higher-level element + function from failure effects
      - Extract lower-level element name from numbered cause text
      - Extract lower-level function from cause description
      - Classify noise factors from cause text

Both formats produce the same output schema:
  {
    focus_element:    str,
    higher_elements:  [{ name, functions[] }],
    lower_elements:   [{ name, functions[] }],
    focus_functions:  str[],
    failure_modes:    [{
      focus_fn, failure_mode, failure_effect,
      severity, occurrence, detection, rpn,
      classification, prevention_controls, detection_controls,
      causes: [{
        lower_element, lower_fn, cause_text,
        noise_driven, noise_category, noise_factor,
        occurrence, detection
      }]
    }],
    noise_factors: {
      pieceTopiece, changeOverTime, customerUsage,
      externalEnvironment, systemInteractions
    }
  }

Usage:
  python dfmea_universal_parser.py <path_to_xlsx> [sheet_name]
"""

from __future__ import annotations

import re
import json
import uuid
from pathlib import Path
from collections import defaultdict
from typing import Any

import pandas as pd

# ─────────────────────────────────────────────────────────────────────────────
# LLM CLIENT  (same interface as existing llm_client.py)
# ─────────────────────────────────────────────────────────────────────────────

import os
import requests

_BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "ap-south-1")
_BEDROCK_MODEL  = os.environ.get("BEDROCK_MODEL",  "anthropic.claude-3-5-sonnet-20241022-v2:0")
_BEDROCK_KEY    = os.environ.get("BEDROCK_API_KEY", "")
_BEDROCK_URL    = f"https://bedrock-runtime.{_BEDROCK_REGION}.amazonaws.com/model/{_BEDROCK_MODEL}/invoke"

_SYSTEM = (
    "You are an expert DFMEA engineer following AIAG-VDA methodology. "
    "Return ONLY what is asked — no preamble, no markdown fences, no explanation."
)


def _llm(prompt: str, max_tokens: int = 600) -> str:
    """Call AWS Bedrock. Falls back to stub if no key is set (for testing)."""
    if not _BEDROCK_KEY:
        # ── Offline stub for unit testing without credentials ──────────────
        return _llm_stub(prompt)
    headers = {"Authorization": f"Bearer {_BEDROCK_KEY}", "Content-Type": "application/json"}
    payload = {
        "anthropic_version": "bedrock-2023-05-31",
        "system":  _SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }
    resp = requests.post(_BEDROCK_URL, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()["content"][0]["text"].strip()


def _llm_stub(prompt: str) -> str:
    """
    Offline stub — returns deterministic placeholder JSON so the parser
    runs end-to-end without AWS credentials.
    Real deployments replace this with the live LLM call.
    """
    if "higher-level element" in prompt.lower() or "higher level element" in prompt.lower():
        return json.dumps({
            "higher_element": "Vehicle System",
            "higher_function": "Maintain safe vehicle operation",
        })
    if "lower-level element" in prompt.lower() or "lower level element" in prompt.lower():
        return json.dumps({
            "lower_element": "Sub-component",
            "lower_function": "Perform sub-system function",
        })
    if "function" in prompt.lower() and "failure mode" in prompt.lower():
        return "Perform intended function"
    if "noise" in prompt.lower():
        return json.dumps({
            "noise_driven": False,
            "noise_category": None,
            "noise_factor": None,
        })
    return "{}"


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4())[:8]

def _s(v: Any) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()

def _int(v: Any) -> int | None:
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None

def _strip_json(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

def _parse_json(text: str) -> dict:
    try:
        return json.loads(_strip_json(text))
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# FORMAT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

# Fingerprint strings that distinguish the two formats
_AIAG_FINGERPRINTS = {
    "next higher level", "focus element", "next lower level",
    "failure effect (fe)", "failure mode (fm)", "failure cause (fc)",
}
_LEGACY_FINGERPRINTS = {
    "item / function", "item/function", "requirement",
    "potential failure mode", "potential effect", "potential cause",
    "controls prevention", "controls detection",
}


def detect_format(header_values: list[str]) -> str:
    """
    Returns "aiag_vda" or "legacy" based on column header text.
    """
    lowered = {h.lower().strip() for h in header_values if h}
    aiag_hits   = sum(1 for f in _AIAG_FINGERPRINTS   if any(f in h for h in lowered))
    legacy_hits = sum(1 for f in _LEGACY_FINGERPRINTS if any(f in h for h in lowered))
    return "aiag_vda" if aiag_hits >= legacy_hits else "legacy"


def find_header_row(df: pd.DataFrame) -> int:
    """
    Scan the first 20 rows to find the one that looks like a column header.
    Returns its 0-based index.
    """
    for i in range(min(20, len(df))):
        row_text = " ".join(_s(v).lower() for v in df.iloc[i].tolist())
        hits = sum(1 for kw in (
            "item", "function", "failure mode", "severity", "occurrence",
            "detection", "cause", "effect", "requirement", "next higher",
        ) if kw in row_text)
        if hits >= 3:
            return i
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN MAPPER  — maps semantic names → actual column indices for either format
# ─────────────────────────────────────────────────────────────────────────────

_AIAG_SEMANTIC = {
    "higher_element": ["next higher level"],
    "focus_element":  ["focus element"],
    "lower_element":  ["next lower level"],
    "higher_fn":      ["next higher level function", "higher level function"],
    "focus_fn":       ["focus element function", "focus function"],
    "lower_fn":       ["next lower level function", "lower level function"],
    "failure_effect": ["failure effect (fe)", "failure effect to the next higher"],
    "severity":       ["severity (s) of failure", "severity (s)"],
    "classification": ["classification"],
    "failure_mode":   ["failure mode (fm)", "failure mode of the focus"],
    "failure_cause":  ["failure cause (fc)", "failure cause of the next lower"],
    "prevention":     ["current prevention controls (pc)", "current prevention controls"],
    "occurrence":     ["occurrence (o) of fc", "occurrence (o)"],
    "detection_ctrl": ["current detection controls (dc)", "current detection controls"],
    "detection":      ["detection (d) of fc", "detection (d)"],
    "ap":             ["ap"],
}

_LEGACY_SEMANTIC = {
    "item_function":  ["item / function", "item/function", "item", "function"],
    "requirement":    ["requirement"],
    "failure_mode":   ["potential failure mode", "failure mode"],
    "failure_effect": ["potential effect(s) of failure", "potential effect", "potential effects"],
    "severity":       ["severity", "sev"],
    "classification": ["classification", "class"],
    "failure_cause":  ["potential cause(s) of failure", "potential causes", "potential cause"],
    "prevention":     ["controls prevention", "prevention control", "current prevention"],
    "occurrence":     ["occurrence", "occ"],
    "detection_ctrl": ["controls detection", "detection control", "current detection"],
    "detection":      ["detection", "det"],
    "rpn":            ["rpn"],
}


def map_columns(header_row: list[str], fmt: str) -> dict[str, int]:
    """
    Returns { semantic_name: column_index } for all columns we can match.
    """
    semantic_map = _AIAG_SEMANTIC if fmt == "aiag_vda" else _LEGACY_SEMANTIC
    result: dict[str, int] = {}
    for semantic, keywords in semantic_map.items():
        for ci, raw_h in enumerate(header_row):
            h = _s(raw_h).lower().strip()
            if not h:
                continue
            if any(kw in h for kw in keywords):
                if semantic not in result:   # first match wins
                    result[semantic] = ci
    return result


# ─────────────────────────────────────────────────────────────────────────────
# NOISE CLASSIFICATION  (LLM-assisted)
# ─────────────────────────────────────────────────────────────────────────────

# Fast regex pre-filter to avoid LLM calls for obvious non-noise causes
_NOISE_RE = re.compile(
    r"overload|overloading|excess.*load|temperature|\+\d+.*deg|-\d+.*deg|"
    r"salt|corrosive|wading|water ingress|mining|paved road|river sand|"
    r"molten tar|dust|vibration.*road|extreme load|operating in|operating on|"
    r"operating with|environmental|humidity|altitude",
    re.IGNORECASE,
)

_NOISE_CATS = ["pieceTopiece", "changeOverTime", "customerUsage", "externalEnvironment", "systemInteractions"]

_CAT_KEYWORDS = {
    "pieceTopiece":        ["dimension", "tolerance", "variation", "manufacturing", "assembly", "material property"],
    "changeOverTime":      ["wear", "fatigue", "corrosion", "age", "degrade", "creep", "drift", "life", "cycle"],
    "customerUsage":       ["overload", "load", "road", "speed", "duty cycle", "misuse", "abuse", "operator"],
    "externalEnvironment": ["temperature", "humidity", "salt", "dust", "vibration", "altitude", "water", "molten", "deg"],
    "systemInteractions":  ["interaction", "adjacent", "system", "interface", "cross-talk", "shared"],
}


def classify_cause_noise(cause_text: str, use_llm: bool = True) -> dict:
    """
    Given a failure cause string, determine:
      - noise_driven:   bool — is this cause from an external noise/environment?
      - noise_category: str  — one of the 5 P-diagram categories (or None)
      - noise_factor:   str  — concise label for the specific factor (or None)
    """
    if not cause_text.strip():
        return {"noise_driven": False, "noise_category": None, "noise_factor": None}

    # Fast regex gate
    if not _NOISE_RE.search(cause_text):
        # Doesn't match any noise pattern — design-mechanism cause
        return {"noise_driven": False, "noise_category": None, "noise_factor": None}

    if not use_llm:
        # Deterministic fallback: pick category by keyword frequency
        cat = _classify_cat_by_keywords(cause_text)
        factor = _extract_factor_regex(cause_text)
        return {"noise_driven": True, "noise_category": cat, "noise_factor": factor}

    prompt = f"""Analyse this DFMEA failure cause and determine if it is driven by a noise factor (external condition):

Failure cause: "{cause_text}"

A noise factor is an external condition that the design cannot control, such as:
- Operating environment (temperature, humidity, salt, dust, wading)  
- Customer usage pattern (overloading, road type, duty cycle)
- Material variation / piece-to-piece variation
- System-level interactions from adjacent systems
- Change over time (wear, fatigue, corrosion)

Output ONLY valid JSON, no markdown:
{{
  "noise_driven": <true|false>,
  "noise_category": <"pieceTopiece"|"changeOverTime"|"customerUsage"|"externalEnvironment"|"systemInteractions"|null>,
  "noise_factor": <"short label for the specific factor e.g. '+52°C high temperature', 'salt pan corrosion', 'overloading 150%'"|null>
}}"""

    raw = _llm(prompt, max_tokens=200)
    result = _parse_json(raw)
    return {
        "noise_driven":   bool(result.get("noise_driven", False)),
        "noise_category": result.get("noise_category"),
        "noise_factor":   result.get("noise_factor"),
    }


def _classify_cat_by_keywords(text: str) -> str:
    text_l = text.lower()
    scores = {cat: sum(1 for kw in kws if kw in text_l) for cat, kws in _CAT_KEYWORDS.items()}
    return max(scores, key=lambda k: scores[k])


def _extract_factor_regex(text: str) -> str | None:
    m = re.search(r"due to (.+?)(?:\.|$)", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()[:80]
    return text[:60]


# ─────────────────────────────────────────────────────────────────────────────
# LLM EXTRACTION FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def llm_infer_higher_element(
    failure_effects: list[str],
    focus_element: str,
) -> dict:
    """
    Given a list of failure effects (what happens to the next higher level),
    infer the name and function of the higher-level element.
    Returns { higher_element: str, higher_function: str }
    """
    effects_text = "\n".join(f"- {e}" for e in failure_effects[:10])
    prompt = f"""A DFMEA for "{focus_element}" lists these failure effects on the next higher-level system:
{effects_text}

Infer:
1. The name of the higher-level system (e.g. "Vehicle", "Powertrain System", "Chassis")
2. Its primary function that is being affected

Output ONLY valid JSON:
{{
  "higher_element": "<system name>",
  "higher_function": "<what the higher system is supposed to do>"
}}"""
    return _parse_json(_llm(prompt, max_tokens=150))


def llm_infer_focus_function_from_mode(
    failure_mode: str,
    item_name: str,
    requirement: str = "",
) -> str:
    """
    Infer the positive function from a failure mode.
    "Motor Internal Failure" → "Provide motor drive output"
    "Does not maintain suspension geometry" → "Maintain suspension geometry"
    """
    req_ctx = f"\nRequirement: {requirement}" if requirement else ""
    prompt = f"""Given this DFMEA failure mode for "{item_name}":
Failure mode: "{failure_mode}"{req_ctx}

State the intended FUNCTION of "{item_name}" that this failure mode violates.
The function must be a positive statement: a verb + object.
Example: "Maintain suspension geometry", "Transmit braking torque", "Provide motor output"

Output ONLY the function text, nothing else."""
    return _llm(prompt, max_tokens=80).strip().strip('"')


def llm_extract_lower_element_and_function(
    cause_text: str,
    item_name: str,
    failure_mode: str,
) -> dict:
    """
    For legacy format: extract lower-level element name and its function from
    a cause string like "1.1.1.1. Motor Internal Failure" or
    "Linkages are coming out from Motor rotatory link & ball joints".

    Returns { lower_element: str, lower_function: str }
    """
    prompt = f"""In a DFMEA for "{item_name}", this failure cause was given:
"{cause_text}"

The failure mode is: "{failure_mode}"

1. Identify the specific sub-component or lower-level element named in this cause.
   If a numbered item (e.g. "1.1.1.1") is present, use the description after it.
2. State the intended function of that sub-component (what it is supposed to do).

Output ONLY valid JSON:
{{
  "lower_element": "<sub-component name>",
  "lower_function": "<what that sub-component is supposed to do>"
}}"""
    result = _parse_json(_llm(prompt, max_tokens=150))
    return {
        "lower_element": result.get("lower_element", _extract_component_name(cause_text)),
        "lower_function": result.get("lower_function", "Perform sub-component function"),
    }


def llm_batch_extract_lower_elements(
    causes: list[str],
    item_name: str,
    failure_mode: str,
) -> list[dict]:
    """
    Batch version — extract lower element + function for all causes in one call.
    More efficient than calling one-by-one for large DFMEAs.
    """
    if not causes:
        return []
    causes_text = "\n".join(f"{i+1}. {c}" for i, c in enumerate(causes))
    prompt = f"""In a DFMEA for "{item_name}" with failure mode "{failure_mode}", 
these failure causes are listed:
{causes_text}

For each cause, identify:
1. The lower-level sub-component mentioned
2. Its intended function (positive statement: verb + object)

Output ONLY valid JSON array, one object per cause in the same order:
[
  {{"lower_element": "<name>", "lower_function": "<function>"}},
  ...
]"""
    raw = _llm(prompt, max_tokens=min(600, len(causes) * 60))
    text = _strip_json(raw)
    try:
        results = json.loads(text)
        if isinstance(results, list) and len(results) == len(causes):
            return results
    except Exception:
        pass
    # fallback: one call per cause
    return [llm_extract_lower_element_and_function(c, item_name, failure_mode) for c in causes]


def _extract_component_name(cause_text: str) -> str:
    """Regex fallback to extract component name from numbered cause like '1.1.1.1. Motor Failure'."""
    m = re.match(r"^[\d.]+\s*\.?\s*(.+?)(?:\s+(?:fails?|breaks?|degrades?|leaks?).*)?$",
                 cause_text.strip(), re.IGNORECASE)
    if m:
        return m.group(1).strip()[:60]
    return cause_text.strip()[:60]


# ─────────────────────────────────────────────────────────────────────────────
# FORMAT A PARSER — AIAG-VDA 2019
# ─────────────────────────────────────────────────────────────────────────────

def parse_aiag_vda(df: pd.DataFrame, col: dict[str, int]) -> dict:
    """
    Parse AIAG-VDA 2019 format DataFrame.
    Functions are explicit in the spreadsheet — LLM used only for noise classification.
    """
    rows_out: list[dict] = []
    noise_accumulator: dict[str, set] = {c: set() for c in _NOISE_CATS}

    for _, row in df.iterrows():
        higher_el = _s(row.get(col.get("higher_element", -1), ""))
        focus_el  = _s(row.get(col.get("focus_element",  -1), ""))
        lower_el  = _s(row.get(col.get("lower_element",  -1), ""))
        higher_fn = _s(row.get(col.get("higher_fn",      -1), ""))
        focus_fn  = _s(row.get(col.get("focus_fn",       -1), ""))
        lower_fn  = _s(row.get(col.get("lower_fn",       -1), ""))
        fe        = _s(row.get(col.get("failure_effect",  -1), ""))
        sev       = _int(row.get(col.get("severity",      -1), ""))
        fm        = _s(row.get(col.get("failure_mode",    -1), ""))
        fc        = _s(row.get(col.get("failure_cause",   -1), ""))
        prev      = _s(row.get(col.get("prevention",      -1), ""))
        occ       = _int(row.get(col.get("occurrence",    -1), ""))
        det_ctrl  = _s(row.get(col.get("detection_ctrl",  -1), ""))
        det       = _int(row.get(col.get("detection",     -1), ""))
        cls       = _s(row.get(col.get("classification",  -1), ""))
        ap        = _s(row.get(col.get("ap",              -1), ""))

        if not focus_el and not fm:
            continue

        # Noise classification for the cause
        noise_info = classify_cause_noise(fc, use_llm=bool(_BEDROCK_KEY))
        if noise_info["noise_driven"] and noise_info["noise_category"] and noise_info["noise_factor"]:
            noise_accumulator[noise_info["noise_category"]].add(noise_info["noise_factor"])

        rpn = (sev or 0) * (occ or 0) * (det or 0) or None

        rows_out.append({
            "id":                  _uid(),
            "higher_element":      higher_el,
            "focus_element":       focus_el,
            "lower_element":       lower_el,
            "higher_fn":           higher_fn,
            "focus_fn":            focus_fn,
            "lower_fn":            lower_fn,
            "failure_effect":      fe,
            "severity":            sev,
            "classification":      cls,
            "failure_mode":        fm,
            "failure_cause":       fc,
            "prevention_controls": prev,
            "occurrence":          occ,
            "detection_controls":  det_ctrl,
            "detection":           det,
            "rpn":                 rpn,
            "ap":                  ap,
            "noise_driven":        noise_info["noise_driven"],
            "noise_category":      noise_info["noise_category"],
            "noise_factor":        noise_info["noise_factor"],
        })

    return _assemble_output(rows_out, noise_accumulator, fmt="aiag_vda")


# ─────────────────────────────────────────────────────────────────────────────
# FORMAT B PARSER — Legacy Ford/GM/Chrysler
# ─────────────────────────────────────────────────────────────────────────────

def parse_legacy(df: pd.DataFrame, col: dict[str, int]) -> dict:
    """
    Parse legacy Ford/GM/Chrysler format.
    - "Item/Function" column contains focus system + merged sub-item rows.
    - "Requirement" column contains function statement.
    - No higher-level element column.
    - LLM used to:
        * Infer higher element from failure effects
        * Extract lower element + function from cause text
        * Derive focus function from failure mode if not in Requirement col
    """

    # ── Pass 1: Forward-fill the Item/Function column (merged cells) ──────────
    item_col_idx  = col.get("item_function", 0)
    req_col_idx   = col.get("requirement",   1)

    # pandas read with no merge resolution — need to ffill
    item_col = df.iloc[:, item_col_idx].copy()
    req_col  = df.iloc[:, req_col_idx].copy()
    item_col = item_col.apply(_s)
    req_col  = req_col.apply(_s)

    # Forward fill blank item cells (merged cell groups)
    current_item = ""
    items_filled: list[str] = []
    for v in item_col:
        if v:
            current_item = v
        items_filled.append(current_item)

    # Also forward-fill requirement (it often spans multiple cause rows)
    current_req = ""
    reqs_filled: list[str] = []
    for v in req_col:
        if v:
            current_req = v
        reqs_filled.append(current_req)

    # ── Pass 2: Collect failure effects to infer higher element ───────────────
    fe_col_idx = col.get("failure_effect", -1)
    all_effects: list[str] = []
    if fe_col_idx >= 0:
        for v in df.iloc[:, fe_col_idx]:
            s = _s(v)
            if s:
                all_effects.append(s)

    # Infer higher element once for the whole DFMEA
    focus_elements = sorted({v for v in items_filled if v})
    focus_element = focus_elements[0] if focus_elements else "Focus System"

    higher_info = llm_infer_higher_element(list(set(all_effects))[:8], focus_element)
    higher_element  = higher_info.get("higher_element", "Vehicle System")
    higher_function = higher_info.get("higher_function", "Maintain vehicle operation")

    # ── Pass 3: Process each data row ─────────────────────────────────────────
    rows_out: list[dict] = []
    noise_accumulator: dict[str, set] = {c: set() for c in _NOISE_CATS}

    # Group consecutive rows that share item+requirement (same failure mode block)
    # so we can batch-call LLM for lower element extraction
    # First, collect all raw rows
    raw_rows: list[dict] = []
    for ri in range(len(df)):
        fm_val   = _s(df.iloc[ri, col["failure_mode"]])   if "failure_mode"   in col else ""
        fe_val   = _s(df.iloc[ri, fe_col_idx])            if fe_col_idx >= 0   else ""
        sev_val  = df.iloc[ri, col["severity"]]           if "severity"        in col else None
        fc_val   = _s(df.iloc[ri, col["failure_cause"]])  if "failure_cause"   in col else ""
        prev_val = _s(df.iloc[ri, col["prevention"]])     if "prevention"      in col else ""
        occ_val  = df.iloc[ri, col["occurrence"]]         if "occurrence"      in col else None
        dc_val   = _s(df.iloc[ri, col["detection_ctrl"]]) if "detection_ctrl"  in col else ""
        det_val  = df.iloc[ri, col["detection"]]          if "detection"       in col else None
        rpn_val  = df.iloc[ri, col["rpn"]]                if "rpn"             in col else None
        cls_val  = _s(df.iloc[ri, col["classification"]]) if "classification"  in col else ""

        item_val = items_filled[ri]
        req_val  = reqs_filled[ri]

        if not item_val:
            continue
        # Skip rows with no failure mode AND no cause (likely blank rows)
        if not fm_val and not fc_val:
            continue

        sev_int = _int(sev_val)
        occ_int = _int(occ_val)
        det_int = _int(det_val)
        rpn_int = _int(rpn_val) or ((sev_int or 0) * (occ_int or 0) * (det_int or 0) or None)

        raw_rows.append({
            "item":        item_val,
            "requirement": req_val,
            "fm":          fm_val,
            "fe":          fe_val,
            "severity":    sev_int,
            "classification": cls_val,
            "fc":          fc_val,
            "prevention":  prev_val,
            "occurrence":  occ_int,
            "det_ctrl":    dc_val,
            "detection":   det_int,
            "rpn":         rpn_int,
        })

    # ── Batch lower element extraction per (item, failure_mode) group ─────────
    # Group causes by their failure mode so we batch one LLM call per mode
    from itertools import groupby

    # Build a key → [causes] map
    cause_groups: dict[tuple, list[str]] = defaultdict(list)
    for rr in raw_rows:
        if rr["fc"]:
            cause_groups[(rr["item"], rr["fm"])].append(rr["fc"])

    lower_info_cache: dict[tuple, list[dict]] = {}
    for (item, fm), causes in cause_groups.items():
        unique_causes = list(dict.fromkeys(causes))  # deduplicate, preserve order
        lower_info_cache[(item, fm)] = llm_batch_extract_lower_elements(unique_causes, item, fm)

    # ── Derive focus functions from requirement + failure mode ─────────────────
    fn_cache: dict[tuple, str] = {}  # (item, requirement, fm) → function

    for rr in raw_rows:
        key = (rr["item"], rr["requirement"], rr["fm"])
        if key not in fn_cache:
            if rr["requirement"] and len(rr["requirement"]) > 5:
                fn_cache[key] = rr["requirement"]
            elif rr["fm"]:
                fn_cache[key] = llm_infer_focus_function_from_mode(
                    rr["fm"], rr["item"], rr["requirement"]
                )
            else:
                fn_cache[key] = rr["requirement"] or rr["item"]

    # ── Build output rows ─────────────────────────────────────────────────────
    for rr in raw_rows:
        focus_fn = fn_cache.get((rr["item"], rr["requirement"], rr["fm"]), rr["requirement"])

        # Look up lower element info
        lower_infos = lower_info_cache.get((rr["item"], rr["fm"]), [])
        causes_list = cause_groups.get((rr["item"], rr["fm"]), [])
        fc = rr["fc"]

        # Find the matching lower info for this specific cause
        lower_el = ""
        lower_fn = ""
        if fc and fc in causes_list:
            idx = causes_list.index(fc)
            if idx < len(lower_infos):
                lower_el = lower_infos[idx].get("lower_element", "")
                lower_fn = lower_infos[idx].get("lower_function", "")

        # Noise classification
        noise_info = classify_cause_noise(fc, use_llm=bool(_BEDROCK_KEY))
        if noise_info["noise_driven"] and noise_info["noise_category"] and noise_info["noise_factor"]:
            noise_accumulator[noise_info["noise_category"]].add(noise_info["noise_factor"])

        rows_out.append({
            "id":                  _uid(),
            "higher_element":      higher_element,
            "focus_element":       rr["item"],
            "lower_element":       lower_el,
            "higher_fn":           higher_function,
            "focus_fn":            focus_fn,
            "lower_fn":            lower_fn,
            "failure_effect":      rr["fe"],
            "severity":            rr["severity"],
            "classification":      rr["classification"],
            "failure_mode":        rr["fm"],
            "failure_cause":       fc,
            "prevention_controls": rr["prevention"],
            "occurrence":          rr["occurrence"],
            "detection_controls":  rr["det_ctrl"],
            "detection":           rr["detection"],
            "rpn":                 rr["rpn"],
            "ap":                  None,
            "noise_driven":        noise_info["noise_driven"],
            "noise_category":      noise_info["noise_category"],
            "noise_factor":        noise_info["noise_factor"],
        })

    return _assemble_output(rows_out, noise_accumulator, fmt="legacy")


# ─────────────────────────────────────────────────────────────────────────────
# OUTPUT ASSEMBLER  — same schema for both formats
# ─────────────────────────────────────────────────────────────────────────────

def _assemble_output(rows: list[dict], noise_acc: dict[str, set], fmt: str) -> dict:
    """
    Collapse raw rows into the canonical output schema.
    """
    if not rows:
        return {"error": "No data rows found"}

    # ── Focus element (most common value in focus_element column) ─────────────
    from collections import Counter
    focus_el_counts = Counter(r["focus_element"] for r in rows if r["focus_element"])
    focus_element = focus_el_counts.most_common(1)[0][0] if focus_el_counts else ""

    # ── Higher elements + functions ───────────────────────────────────────────
    higher_map: dict[str, set] = defaultdict(set)
    for r in rows:
        if r["higher_element"]:
            if r["higher_fn"]:
                higher_map[r["higher_element"]].add(r["higher_fn"])
    higher_elements = [
        {"name": el, "functions": sorted(fns)}
        for el, fns in sorted(higher_map.items())
    ]

    # ── Lower elements + functions ────────────────────────────────────────────
    lower_map: dict[str, set] = defaultdict(set)
    for r in rows:
        if r["lower_element"]:
            if r["lower_fn"]:
                lower_map[r["lower_element"]].add(r["lower_fn"])
            else:
                lower_map[r["lower_element"]]  # ensure key exists
    lower_elements = [
        {"name": el, "functions": sorted(fns)}
        for el, fns in sorted(lower_map.items())
    ]

    # ── Focus functions (deduplicated) ────────────────────────────────────────
    focus_functions = sorted(set(r["focus_fn"] for r in rows if r["focus_fn"]))

    # ── Failure modes grouped ─────────────────────────────────────────────────
    # Key: (focus_fn, failure_mode) — group all causes under each mode
    mode_map: dict[tuple, dict] = {}
    for r in rows:
        key = (r["focus_fn"], r["failure_mode"])
        if key not in mode_map:
            mode_map[key] = {
                "id":                _uid(),
                "focus_fn":          r["focus_fn"],
                "failure_mode":      r["failure_mode"],
                "failure_effect":    r["failure_effect"],
                "severity":          r["severity"],
                "classification":    r["classification"],
                "causes":            [],
            }
        # Add cause if not duplicate
        cause_entry = {
            "id":                  r["id"],
            "lower_element":       r["lower_element"],
            "lower_fn":            r["lower_fn"],
            "cause_text":          r["failure_cause"],
            "prevention_controls": r["prevention_controls"],
            "detection_controls":  r["detection_controls"],
            "occurrence":          r["occurrence"],
            "detection":           r["detection"],
            "rpn":                 r["rpn"],
            "ap":                  r["ap"],
            "noise_driven":        r["noise_driven"],
            "noise_category":      r["noise_category"],
            "noise_factor":        r["noise_factor"],
        }
        # Deduplicate causes by cause_text
        existing_causes = {c["cause_text"] for c in mode_map[key]["causes"]}
        if cause_entry["cause_text"] not in existing_causes:
            mode_map[key]["causes"].append(cause_entry)

    failure_modes = list(mode_map.values())

    # ── Noise factors ─────────────────────────────────────────────────────────
    noise_factors = {cat: sorted(items) for cat, items in noise_acc.items()}

    # ── S/O/D summary per element ─────────────────────────────────────────────
    # For each lower element: max severity, avg occurrence, avg detection
    element_ratings: dict[str, dict] = defaultdict(lambda: {"severities": [], "occurrences": [], "detections": []})
    for r in rows:
        el = r["lower_element"] or r["focus_element"]
        if r["severity"]  is not None: element_ratings[el]["severities"].append(r["severity"])
        if r["occurrence"] is not None: element_ratings[el]["occurrences"].append(r["occurrence"])
        if r["detection"]  is not None: element_ratings[el]["detections"].append(r["detection"])

    sod_by_element = {}
    for el, vals in element_ratings.items():
        sod_by_element[el] = {
            "max_severity":  max(vals["severities"])             if vals["severities"]  else None,
            "avg_occurrence": round(sum(vals["occurrences"]) / len(vals["occurrences"]), 1) if vals["occurrences"] else None,
            "avg_detection":  round(sum(vals["detections"])  / len(vals["detections"]),  1) if vals["detections"]  else None,
            "max_rpn": None,  # computed below
        }

    # Max RPN per element
    rpn_by_element: dict[str, list[int]] = defaultdict(list)
    for r in rows:
        el = r["lower_element"] or r["focus_element"]
        if r["rpn"] is not None:
            rpn_by_element[el].append(r["rpn"])
    for el, rpns in rpn_by_element.items():
        if el in sod_by_element:
            sod_by_element[el]["max_rpn"] = max(rpns)

    return {
        "format_detected":  fmt,
        "focus_element":    focus_element,
        "higher_elements":  higher_elements,
        "lower_elements":   lower_elements,
        "focus_functions":  focus_functions,
        "failure_modes":    failure_modes,
        "noise_factors":    noise_factors,
        "sod_by_element":   sod_by_element,
        "raw_rows":         rows,  # full detail for downstream use
        "stats": {
            "total_rows":        len(rows),
            "failure_mode_count": len(failure_modes),
            "lower_element_count": len(lower_elements),
            "noise_driven_count": sum(1 for r in rows if r["noise_driven"]),
            "design_cause_count": sum(1 for r in rows if not r["noise_driven"]),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# SHEET FINDER — picks the most likely DFMEA worksheet from a multi-sheet xlsx
# ─────────────────────────────────────────────────────────────────────────────

_DFMEA_SHEET_KEYWORDS = ["dfmea", "worksheet", "fmea", "failure mode"]


def find_dfmea_sheet(xl: dict[str, pd.DataFrame]) -> tuple[str, pd.DataFrame]:
    """Return (sheet_name, DataFrame) for the most likely DFMEA data sheet."""
    for name, df in xl.items():
        if any(kw in name.lower() for kw in _DFMEA_SHEET_KEYWORDS):
            return name, df
    # Fallback: the sheet with the most rows
    best = max(xl.items(), key=lambda kv: len(kv[1]))
    return best


# ─────────────────────────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def parse_dfmea_file(path: str, sheet_name: str | None = None) -> dict:
    """
    Universal parser entry point.

    Parameters
    ----------
    path        : path to the xlsx file
    sheet_name  : optional — if None, auto-detected

    Returns
    -------
    Canonical output dict (see module docstring for schema).
    """
    xl = pd.read_excel(path, sheet_name=None, header=None)

    if sheet_name and sheet_name in xl:
        df_raw = xl[sheet_name]
    else:
        sheet_name, df_raw = find_dfmea_sheet(xl)

    print(f"[parser] Using sheet: '{sheet_name}'  shape={df_raw.shape}")

    # ── Find the header row ───────────────────────────────────────────────────
    header_row_idx = find_header_row(df_raw)
    print(f"[parser] Header row detected at index {header_row_idx}")

    header_values = [_s(v) for v in df_raw.iloc[header_row_idx].tolist()]
    data_df = df_raw.iloc[header_row_idx + 1:].reset_index(drop=True)
    data_df.columns = range(data_df.shape[1])

    # ── Detect format ─────────────────────────────────────────────────────────
    fmt = detect_format(header_values)
    print(f"[parser] Format detected: {fmt}")

    # ── Map columns ───────────────────────────────────────────────────────────
    col = map_columns(header_values, fmt)
    print(f"[parser] Columns mapped: {col}")

    # ── Parse ─────────────────────────────────────────────────────────────────
    # Convert column indices to actual column access
    # data_df columns are 0-indexed integers, so col values are direct indices
    # We need to access rows by integer column index, not by name

    # Wrap data_df so row[col_idx] works cleanly
    if fmt == "aiag_vda":
        result = parse_aiag_vda(_wrap_df(data_df, col), col)
    else:
        result = parse_legacy(_wrap_df(data_df, col), col)

    result["source_file"] = Path(path).name
    result["sheet_name"]  = sheet_name
    return result


def _wrap_df(df: pd.DataFrame, col: dict[str, int]) -> pd.DataFrame:
    """
    Return a DataFrame where each row can be accessed by col dict values.
    Rows that are completely empty are dropped.
    """
    # Drop fully empty rows
    df = df.dropna(how="all").reset_index(drop=True)
    return df


# ─────────────────────────────────────────────────────────────────────────────
# CASE BUILDERS  (imported from existing logic, adapted for universal schema)
# ─────────────────────────────────────────────────────────────────────────────

def build_case1_new_conditions(parsed: dict) -> dict:
    """
    Case 1: Same design, new operating environment.
    - Keep: elements, functions, failure modes
    - Strip: noise-driven causes (replace with user's new noise factors)
    - Clear: O and D ratings (those depend on new environment)
    - Keep: S ratings (severity is system-level, independent of environment)
    """
    rows = parsed.get("raw_rows", [])

    modes_out = []
    seen: set[tuple] = set()
    for r in rows:
        key = (r["focus_fn"], r["failure_mode"])
        if key not in seen:
            seen.add(key)
        is_noise = r.get("noise_driven", False)
        modes_out.append({
            "focus_fn":      r["focus_fn"],
            "failure_mode":  r["failure_mode"],
            "failure_effect": r["failure_effect"],
            "severity":      r["severity"],   # retained
            "cause":         None if is_noise else r["failure_cause"],
            "lower_element": r["lower_element"],
            "lower_fn":      r["lower_fn"],
            "occurrence":    None,  # cleared
            "detection":     None,  # cleared
            "noise_driven":  is_noise,
            "noise_label":   r.get("noise_factor"),
        })

    noise_stripped = sorted(set(
        r["noise_factor"] for r in rows
        if r.get("noise_driven") and r.get("noise_factor")
    ))

    return {
        "case": "new_conditions",
        "focus_element":   parsed["focus_element"],
        "higher_elements": parsed["higher_elements"],
        "lower_elements":  parsed["lower_elements"],
        "focus_functions": parsed["focus_functions"],
        "failure_modes":   modes_out,
        "noise_stub": {
            "stripped_factors": noise_stripped,
            "instructions": (
                "These noise factors came from the original operating environment. "
                "Replace with your new conditions in the P-Diagram step. "
                "Noise-driven causes will be re-generated from new noise factors."
            ),
        },
        "stats": {
            "modes": len(seen),
            "causes_retained": sum(1 for r in rows if not r.get("noise_driven")),
            "causes_stripped":  sum(1 for r in rows if r.get("noise_driven")),
        },
    }


def build_case2_modified_design(parsed: dict, modified_elements: list[str] | None = None) -> dict:
    """
    Case 2: Same environment, modified component(s).
    - Keep: elements, functions, failure modes, noise-driven causes (with S/O/D)
    - Strip: design-mechanism causes for modified elements only
    - Re-generate: causes for modified elements via LLM
    """
    rows = parsed.get("raw_rows", [])
    modified_set = set(modified_elements or [])

    modes_out = []
    for r in rows:
        is_modified = bool(modified_set) and (r["lower_element"] in modified_set)
        is_noise    = r.get("noise_driven", False)

        # Retain if: noise-driven (always) OR unmodified element
        retain = is_noise or not is_modified
        modes_out.append({
            "focus_fn":       r["focus_fn"],
            "failure_mode":   r["failure_mode"],
            "failure_effect": r["failure_effect"],
            "severity":       r["severity"],
            "cause":          r["failure_cause"] if retain else None,
            "lower_element":  r["lower_element"],
            "lower_fn":       r["lower_fn"],
            "occurrence":     r["occurrence"] if retain else None,
            "detection":      r["detection"]  if retain else None,
            "rpn":            r["rpn"]         if retain else None,
            "noise_driven":   is_noise,
            "retained":       retain,
            "needs_regen":    not retain,
            "modified_element": is_modified,
        })

    return {
        "case": "modified_design",
        "focus_element":      parsed["focus_element"],
        "higher_elements":    parsed["higher_elements"],
        "lower_elements":     parsed["lower_elements"],
        "focus_functions":    parsed["focus_functions"],
        "noise_factors":      parsed["noise_factors"],
        "failure_modes":      modes_out,
        "modified_elements":  list(modified_set) or "user_to_specify",
        "stats": {
            "total_rows":          len(rows),
            "causes_retained":     sum(1 for m in modes_out if m["retained"]),
            "causes_stripped":     sum(1 for m in modes_out if not m["retained"]),
            "modes_needing_regen": sum(1 for m in modes_out if m["needs_regen"]),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# REPORT PRINTER
# ─────────────────────────────────────────────────────────────────────────────

def print_report(parsed: dict) -> None:
    print("\n" + "=" * 72)
    print(f"  UNIVERSAL DFMEA PARSER REPORT")
    print(f"  Source : {parsed.get('source_file', '—')}")
    print(f"  Sheet  : {parsed.get('sheet_name',  '—')}")
    print(f"  Format : {parsed.get('format_detected', '—').upper()}")
    print("=" * 72)

    print(f"\n  Focus element  : {parsed['focus_element']}")

    print(f"\n  Higher elements ({len(parsed['higher_elements'])}):")
    for he in parsed["higher_elements"]:
        print(f"    · {he['name']}")
        for fn in he["functions"][:3]:
            print(f"        – {fn[:80]}")

    print(f"\n  Lower elements ({len(parsed['lower_elements'])}):")
    for le in parsed["lower_elements"]:
        sod = parsed["sod_by_element"].get(le["name"], {})
        print(f"    · {le['name']}  [max S={sod.get('max_severity')}, avg O={sod.get('avg_occurrence')}, avg D={sod.get('avg_detection')}, max RPN={sod.get('max_rpn')}]")
        for fn in le["functions"][:2]:
            print(f"        – {fn[:80]}")

    print(f"\n  Focus functions ({len(parsed['focus_functions'])}):")
    for fn in parsed["focus_functions"]:
        print(f"    · {fn[:80]}")

    print(f"\n  Failure modes ({len(parsed['failure_modes'])}):")
    for mode in parsed["failure_modes"][:5]:
        causes = mode.get("causes", [])
        print(f"    · [{mode['focus_fn'][:40]}]  →  {mode['failure_mode'][:60]}")
        print(f"      S={mode['severity']}  effect: {mode['failure_effect'][:60]}")
        print(f"      Causes: {len(causes)} total  ({sum(1 for c in causes if c.get('noise_driven'))} noise-driven)")
    if len(parsed["failure_modes"]) > 5:
        print(f"    … and {len(parsed['failure_modes']) - 5} more modes")

    print(f"\n  Noise factors extracted:")
    for cat, factors in parsed["noise_factors"].items():
        if factors:
            print(f"    [{cat}]")
            for f in factors:
                print(f"        · {f}")

    s = parsed["stats"]
    print(f"\n  Stats: {s['total_rows']} rows | {s['failure_mode_count']} modes | "
          f"{s['lower_element_count']} lower elements | "
          f"{s['noise_driven_count']} noise-driven causes | {s['design_cause_count']} design causes")
    print("=" * 72)


# ─────────────────────────────────────────────────────────────────────────────
# FASTAPI ROUTER  (drop into routers/ folder, register in main.py)
# ─────────────────────────────────────────────────────────────────────────────

# To expose as an API endpoint, uncomment and add to main.py:
#
# from fastapi import APIRouter, UploadFile, File, Form
# import tempfile, shutil
#
# router = APIRouter()
#
# @router.post("/api/dfmea/import/parse")
# async def import_parse(
#     file: UploadFile = File(...),
#     case: str = Form("new_conditions"),           # "new_conditions" | "modified_design"
#     modified_elements: str = Form(""),            # comma-separated list
#     sheet_name: str = Form(""),
# ):
#     with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
#         shutil.copyfileobj(file.file, tmp)
#         tmp_path = tmp.name
#
#     parsed = parse_dfmea_file(tmp_path, sheet_name or None)
#     mod_els = [e.strip() for e in modified_elements.split(",") if e.strip()]
#
#     if case == "modified_design":
#         return build_case2_modified_design(parsed, mod_els or None)
#     else:
#         return build_case1_new_conditions(parsed)


# ─────────────────────────────────────────────────────────────────────────────
# CLI ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    path = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "/mnt/user-data/uploads/1-Chassis_System-Axle_System_DFMEA_v4_Final__3_.xlsx"
    )
    sheet = sys.argv[2] if len(sys.argv) > 2 else None

    print(f"[parser] Parsing: {path}")
    parsed = parse_dfmea_file(path, sheet)

    print_report(parsed)

    out_dir = Path("/mnt/user-data/outputs")
    out_dir.mkdir(exist_ok=True)

    # Full parse output
    (out_dir / "universal_parsed_full.json").write_text(
        json.dumps(parsed, indent=2, default=str), encoding="utf-8"
    )

    # Case 1 — new conditions
    case1 = build_case1_new_conditions(parsed)
    (out_dir / "universal_case1_new_conditions.json").write_text(
        json.dumps(case1, indent=2, default=str), encoding="utf-8"
    )

    # Case 2 — modified design (no elements marked yet)
    case2 = build_case2_modified_design(parsed, modified_elements=None)
    (out_dir / "universal_case2_modified_design.json").write_text(
        json.dumps(case2, indent=2, default=str), encoding="utf-8"
    )

    print(f"\n[parser] Outputs written to {out_dir}:")
    print("  · universal_parsed_full.json")
    print("  · universal_case1_new_conditions.json")
    print("  · universal_case2_modified_design.json")
