---
id: 013
title: Frontend module layout and import boundaries
label: wayfinder:grilling
status: open
assignee:
blocked-by: [002, 003]
---

## Question

Decide where the new code lives and how the old code coexists with it
during grow-beside. ARCHITECTURE.md gives the target shape:
`composition/`, `shell/`, `platform/`, `apps/<product>/{index.ts, pages,
features, internal}`.

Settle:

- The directory for the new Drive UI while `apps/drive` still serves the
  old pages: a sibling (`apps/files`), a subtree, or an in-place replacement
  behind a route flag. The area is named Files; the product is Drive.
- What moves into `platform/` on day one and what waits.
- The public interface files (`apps/drive/index.ts` and equivalents) and the
  import-boundary rule update: allowlisted debt, new violations fail.
- Code splitting: per-area chunks, the shell chunk budget, heavy editor
  dependencies on demand.
- Tests: where unit and browser tests for shell, platform and Files live,
  and which existing red baselines are excluded from the gate.
- Ownership per directory (ARCHITECTURE.md rule 9).

Inputs: ARCHITECTURE.md target structure and rules 8 and 9,
`frontend/scripts/check-import-boundaries.mjs`, `frontend/vite.config.ts`,
tickets 002 and 003.

Handed from [frappe-ui shell component gap](004-frappe-ui-shell-component-gap.md)
(2026-09-11): the boundary rules should also refuse new
`frappe-ui/experimental` imports and private-path imports such as
`frappe-ui/src/...` (one exists in `writer/utils/dialogs.ts`). New lists use
`frappe-ui/list`. A move to `v1.0.0-beta.56` costs a toast migration only.
