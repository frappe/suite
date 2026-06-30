"""Server-side validation of the action plan the model returns.

The model is *forced* to call ``emit_actions``, but its arguments are still
untrusted — clamp and drop anything that doesn't match the contract before the
frontend applies it to the grid. Phase 1 understands two action types:

  * ``setCell`` — write a formula/value into one cell (A1 notation)
  * ``answer``  — read-only text response, no mutation
"""

import re

_CELL_RE = re.compile(r"^[A-Z]{1,3}[1-9][0-9]{0,6}$")

MAX_ACTIONS = 200
MAX_FORMULA_LEN = 1000
MAX_ANSWER_LEN = 4000


def clean_actions(raw) -> list:
	"""Return the subset of `raw` that is well-formed; drop the rest."""
	if not isinstance(raw, list):
		return []
	out = []
	for a in raw[:MAX_ACTIONS]:
		if not isinstance(a, dict):
			continue
		t = a.get("type")
		if t == "setCell":
			cell = str(a.get("cell") or "").strip().upper()
			if not _CELL_RE.match(cell):
				continue
			formula = a.get("formula")
			if not isinstance(formula, str):
				if formula is None:
					continue
				formula = str(formula)
			if len(formula) > MAX_FORMULA_LEN:
				continue
			out.append({"type": "setCell", "cell": cell, "formula": formula})
		elif t == "answer":
			text = a.get("text")
			if not isinstance(text, str) or not text.strip():
				continue
			out.append({"type": "answer", "text": text[:MAX_ANSWER_LEN]})
	return out
