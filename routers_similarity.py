"""
routers/similarity.py
POST /api/dfmea/similarity/suggest

For each focus function, suggests which lower and higher functions are
functionally related using an LLM.

Two bugs fixed from original:
  1. return out was inside the for loop — returned after first bullet only
  2. LLM was asked to return opaque random IDs it had never seen — unreliable.
     Now asks for 1-based index numbers which are stable and unambiguous,
     then maps back to IDs server-side.
"""

import re
from fastapi import APIRouter
from pydantic import BaseModel
from llm_client import llm

router = APIRouter()


# ── Models ─────────────────────────────────────────────────────────────────────

class FunctionItem(BaseModel):
    id:          str
    name:        str
    elementName: str


class SuggestRequest(BaseModel):
    lower_functions:  list[FunctionItem]
    focus_functions:  list[FunctionItem]
    higher_functions: list[FunctionItem]
    top_k_lower:      int   = 3
    top_k_higher:     int   = 2
    threshold:        float = 0.55   # kept for API compatibility, unused


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse_index_list(text: str, max_index: int) -> list[int]:
    """
    Parse a bulleted or comma-separated list of 1-based integers from LLM output.
    Returns valid 0-based indices, deduplicated, in order.

    Handles all formats the LLM commonly produces:
      "2, 5"  |  "- 1\n- 3"  |  "1"  |  "NONE" -> []
    """
    if not text or "NONE" in text.upper():
        return []
    found = re.findall(r"\b(\d+)\b", text)
    seen, result = set(), []
    for n in found:
        i = int(n) - 1              # 1-based → 0-based
        if 0 <= i < max_index and i not in seen:
            seen.add(i)
            result.append(i)
    return result


def _suggest_for_focus(
    focus_fn:     FunctionItem,
    lower_fns:    list[FunctionItem],
    higher_fns:   list[FunctionItem],
    top_k_lower:  int,
    top_k_higher: int,
) -> dict:

    # ── Lower connections ──────────────────────────────────────────────────────
    lower_related: list[FunctionItem] = []

    if lower_fns:
        numbered = "\n".join(
            f"{i+1}. [{fn.elementName}] {fn.name}"
            for i, fn in enumerate(lower_fns)
        )
        prompt = f"""Focus function: "{focus_fn.name}"

Lower-level functions (numbered):
{numbered}

TASK: Which lower-level functions directly CAUSE or ENABLE the focus function?
A lower function is related if its failure could directly produce a failure mode
in the focus function.

RULES:
- Output ONLY the numbers of related functions, comma-separated
- Maximum {top_k_lower} numbers
- If none are related output exactly: NONE

OUTPUT (numbers only, e.g. "2, 5" or "NONE"):"""

        try:
            raw = llm.generate(prompt, max_tokens=60)
        except Exception:
            raw = "NONE"

        for i in _parse_index_list(raw, len(lower_fns)):
            lower_related.append(lower_fns[i])

    # ── Higher connections ─────────────────────────────────────────────────────
    higher_related: list[FunctionItem] = []

    if higher_fns:
        numbered = "\n".join(
            f"{i+1}. [{fn.elementName}] {fn.name}"
            for i, fn in enumerate(higher_fns)
        )
        prompt = f"""Focus function: "{focus_fn.name}"

Higher-level functions (numbered):
{numbered}

TASK: Which higher-level functions are directly AFFECTED when the focus function fails?
A higher function is related if losing the focus function degrades or prevents it.

RULES:
- Output ONLY the numbers of related functions, comma-separated
- Maximum {top_k_higher} numbers
- If none are related output exactly: NONE

OUTPUT (numbers only, e.g. "1, 3" or "NONE"):"""

        try:
            raw = llm.generate(prompt, max_tokens=60)
        except Exception:
            raw = "NONE"

        for i in _parse_index_list(raw, len(higher_fns)):
            higher_related.append(higher_fns[i])

    return {
        "lower": [
            {"id": fn.id, "name": fn.name, "elementName": fn.elementName, "similarity": 1.0}
            for fn in lower_related
        ],
        "higher": [
            {"id": fn.id, "name": fn.name, "elementName": fn.elementName, "similarity": 1.0}
            for fn in higher_related
        ],
    }


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("/similarity/suggest")
def similarity_suggest(req: SuggestRequest):
    """
    For each focus function, return the functionally related
    lower and higher functions.

    Response:
    {
      "suggestions": {
        "<focus_fn_id>": {
          "lower":  [{ id, name, elementName, similarity }, ...],
          "higher": [{ id, name, elementName, similarity }, ...]
        }
      }
    }
    """
    valid_lower  = [f for f in req.lower_functions  if f.name.strip()]
    valid_higher = [f for f in req.higher_functions if f.name.strip()]

    suggestions: dict[str, dict] = {}
    for ff in req.focus_functions:
        if not ff.name.strip():
            continue
        suggestions[ff.id] = _suggest_for_focus(
            focus_fn=ff,
            lower_fns=valid_lower,
            higher_fns=valid_higher,
            top_k_lower=req.top_k_lower,
            top_k_higher=req.top_k_higher,
        )

    return {"suggestions": suggestions}
