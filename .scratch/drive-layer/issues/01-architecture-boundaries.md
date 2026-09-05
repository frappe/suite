# 01 — Freeze the Drive interface and enforce product boundaries

**What to build:** Give product callers one supported Drive interface. Detect new boundary violations before the rewrite expands.

**Blocked by:** None — can start immediately after execution is authorized.

**Status:** ready-for-agent

**Owner:** Suite architecture

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §2; architecture charter; architecture gate.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Inventory production callers in Writer, Slides, Sheets, Meet, Suite lifecycle wiring, and existing compatibility endpoints.
- [ ] Freeze the minimal package-root exports from real callers. Keep unfinished workflows unavailable rather than returning placeholder success.
- [ ] Enforce Python imports, dynamic imports, and Frappe hook boundaries. Baseline existing debt with explicit removal owners.
- [ ] Enforce frontend product import boundaries without reorganizing unrelated products.
- [ ] Keep Drive policy private and principals explicit. Record the content contract and composition ownership.
- [ ] Record baseline test failures and the exact Suite/framework revisions before implementation. Preserve existing work.

## Verification

Run architecture checks and export contract checks. Demonstrate that an added forbidden import fails the boundary check.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
