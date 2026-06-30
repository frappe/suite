"""Deterministic intent → grid-action resolver (no LLM).

Handles the common, unambiguous spreadsheet asks straight from the prompt +
selection — aggregations, running totals, percent-of-total, and row-wise text
transforms. Returns a list of actions when it confidently recognises the ask,
or ``None`` when it can't, which lets the caller fall back to the model (or, in
the keyless demo, show a hint).

This is the fast path of a heuristic-first → model-fallback cascade: the muscle
-memory operations resolve here instantly, for free, and deterministically (no
hallucinated formula); the model is only paid for when the heuristic shrugs.

Design rule: be CONSERVATIVE. If the prompt carries a condition or qualifier a
template can't honour ("sum where status is paid", "top 5", "group by"), return
None so the model handles it rather than silently doing the wrong thing. Only
formula functions the engine actually implements are emitted.
"""

import re

from suite.sheets.ai.context import col_to_letters

# A match here means the ask has nuance a template can't capture — hand it off.
# Deliberately excludes positional words like "below"/"above" (which appear in
# plain asks such as "total the column below").
_QUALIFIER_RE = re.compile(
	r"\b(where|only|unless|except|exclud\w*|filter|"
	r"greater than|less than|more than|at least|at most|between|"
	r"group by|grouped by|pivot|distinct|"
	r"top \d|bottom \d|highest \d|lowest \d|"
	r"if)\b",
	re.I,
)

# Aggregations: keyword → engine function. Order matters (specific first).
_AGG = [
	(("average", "avg", "mean"), "AVERAGE"),
	(("median",), "MEDIAN"),
	(("count", "how many", "number of"), "COUNTA"),
	(("maximum", "max", "largest", "highest", "biggest"), "MAX"),
	(("minimum", "min", "smallest", "lowest"), "MIN"),
	(("standard deviation", "std dev", "stdev"), "STDEV"),
	(("product", "multiply"), "PRODUCT"),
	(("sum", "total", "add up", "add them", "add these"), "SUM"),
]

# Row-wise transforms: keyword → builder(srcCellRef) → formula string.
_TRANSFORM = [
	(("uppercase", "upper case", "all caps"), lambda c: f"=UPPER({c})"),
	(("lowercase", "lower case"), lambda c: f"=LOWER({c})"),
	(("proper case", "title case", "propercase", "titlecase", "capitalize"), lambda c: f"=PROPER({c})"),
	(("trim", "remove whitespace", "remove extra spaces", "strip spaces"), lambda c: f"=TRIM({c})"),
	(("length", "char count", "number of characters"), lambda c: f"=LEN({c})"),
	(("domain",), lambda c: f'=MID({c},FIND("@",{c})+1,LEN({c}))'),
	(("before the @", "email user", "username", "local part"), lambda c: f'=LEFT({c},FIND("@",{c})-1)'),
	(("first name",), lambda c: f'=LEFT({c},FIND(" ",{c})-1)'),
	(("last name", "surname"), lambda c: f'=MID({c},FIND(" ",{c})+1,LEN({c}))'),
]


def resolve(prompt: str, context: dict, sel: dict):
	"""Return a list of actions for a recognised ask, else None."""
	p = (prompt or "").lower().strip()
	if not p:
		return None
	rect = _rect(sel)
	if rect is None:
		return None
	lo_r, hi_r, lo_c, hi_c = rect
	qualified = bool(_QUALIFIER_RE.search(p))

	# 1) Running total / percent-of-total — single column, multi-row.
	if not qualified and hi_r > lo_r and lo_c == hi_c:
		if "running total" in p or "cumulative" in p:
			return _running_total(rect)
		if any(x in p for x in ("percent of total", "% of total", "percentage of total", "share of total")):
			return _pct_of_total(rect)

	# 2) Aggregation — one or more columns.
	if not qualified:
		fn = _detect(p, _AGG)
		if fn:
			return _aggregate(fn, rect, context)

	# 3) Row-wise transform — single column.
	if lo_c == hi_c:
		builder = _detect(p, _TRANSFORM)
		if builder:
			return _transform(builder, rect)

	return None


# ── helpers ──────────────────────────────────────────────────────────────────


def _rect(sel):
	try:
		r0, c0 = int(sel.get("r0", 0)), int(sel.get("c0", 0))
		r1, c1 = int(sel.get("r1", r0)), int(sel.get("c1", c0))
	except (TypeError, ValueError, AttributeError):
		return None
	lo_r, hi_r = sorted((r0, r1))
	lo_c, hi_c = sorted((c0, c1))
	return lo_r, hi_r, lo_c, hi_c


def _detect(p, table):
	for keys, val in table:
		if any(k in p for k in keys):
			return val
	return None


def _aggregate(fn, rect, context):
	lo_r, hi_r, lo_c, hi_c = rect
	col_types = (context or {}).get("column_types") or {}
	actions = []
	if hi_r > lo_r:
		# Multi-row: result under each column (skip text columns unless counting).
		for c in range(lo_c, hi_c + 1):
			letter = col_to_letters(c)
			if fn != "COUNTA" and col_types.get(letter) == "text":
				continue
			rng = f"{letter}{lo_r + 1}:{letter}{hi_r + 1}"
			actions.append({"type": "setCell", "cell": f"{letter}{hi_r + 2}", "formula": f"={fn}({rng})"})
	else:
		# Single row: result in the next cell to the right.
		rng = f"{col_to_letters(lo_c)}{lo_r + 1}:{col_to_letters(hi_c)}{lo_r + 1}"
		actions.append({"type": "setCell", "cell": f"{col_to_letters(hi_c + 1)}{lo_r + 1}", "formula": f"={fn}({rng})"})
	return actions or None


def _running_total(rect):
	lo_r, hi_r, lo_c, _ = rect
	src, out = col_to_letters(lo_c), col_to_letters(lo_c + 1)
	return [
		{"type": "setCell", "cell": f"{out}{r + 1}", "formula": f"=SUM({src}${lo_r + 1}:{src}{r + 1})"}
		for r in range(lo_r, hi_r + 1)
	]


def _pct_of_total(rect):
	lo_r, hi_r, lo_c, _ = rect
	src, out = col_to_letters(lo_c), col_to_letters(lo_c + 1)
	total = f"SUM({src}${lo_r + 1}:{src}${hi_r + 1})"
	return [
		{"type": "setCell", "cell": f"{out}{r + 1}", "formula": f"={src}{r + 1}/{total}"}
		for r in range(lo_r, hi_r + 1)
	]


def _transform(builder, rect):
	lo_r, hi_r, lo_c, _ = rect
	src, out = col_to_letters(lo_c), col_to_letters(lo_c + 1)
	return [
		{"type": "setCell", "cell": f"{out}{r + 1}", "formula": builder(f"{src}{r + 1}")}
		for r in range(lo_r, hi_r + 1)
	]
