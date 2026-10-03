---
id: 013
title: Frontend module layout and import boundaries
label: wayfinder:grilling
status: closed
assignee: faris
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

## Resolution

Resolved with the user on 2026-09-15.

### Layout and grow-beside

- Drive remains the product owner of the Files area. New code lives under
  `frontend/src/apps/drive/files/{pages,features,internal}`; there is no
  sibling `apps/files` product.
- The current `/drive` UI moves under `frontend/src/apps/drive/legacy` and
  remains separately routed during grow-beside. The canonical `/files` routes
  load the new subtree directly; there is no route flag selecting between two
  implementations.
- New Files code must not import `apps/drive/legacy`. The boundary checker
  enforces that edge so rollout can delete the legacy subtree as one unit.
  Legacy code may use temporary compatibility shims into the platform while
  its callers migrate.

### Platform and dependency direction

- Day one creates `@/platform/session`, `transport`, `server-state`,
  `realtime`, `translation`, `theme`, `page-meta` and `feedback`, matching
  ticket 002. New shell, composition and Files code use these paths directly;
  old `boot/`, composable and utility paths may temporarily forward to them.
- Sentry and PWA behavior stay where they are until their ownership and
  migration are decided. Miscellaneous shared-looking utilities do not move
  merely because they are outside a product.
- `utils/useChunkedUpload.ts` is explicit legacy debt, not a platform module:
  Mail and Calendar both call it, but its default endpoint is Mail-owned. It
  can move to `platform/upload` only after that product dependency and the
  endpoint ownership are resolved.
- Dependency direction is:

  ```text
  composition -> shell, platform, and product package roots
  shell       -> platform
  products    -> platform and explicitly allowed product package roots
  platform    -> no shell, composition, or product module
  ```

  Products never import shell or composition; shell never imports products;
  composition imports a product only through `@/apps/<product>`.

### Public interfaces and enforcement

- Every product exposes one lightweight cross-product seam at
  `apps/<product>/index.ts`. It exports only interfaces with real consumers,
  such as area definitions and document adapters. Pages, stores, features and
  utilities stay private; public subpath imports are not introduced.
- Extend `frontend/scripts/check-import-boundaries.mjs` to enforce the full
  dependency graph above, the Files-to-legacy prohibition, and package-root-
  only cross-product imports. Existing violations use exact allowlist entries
  with an owner and removal or review condition. A new violation fails, and a
  resolved entry left in the baseline also fails.
- Apply the same exact shrinking-baseline rule to existing
  `frappe-ui/experimental` and `frappe-ui/src/...` imports. New code uses
  stable exports, including `frappe-ui/list` for lists.

### Code splitting and budget

- Each `AreaDefinition` keeps lazy `loadRoutes` and `loadPanel` entry points.
  Entering one area must not load another area's implementation.
- Document surfaces and heavy libraries stay behind deeper dynamic imports:
  Writer, Sheets, Slides, PDF, charts, XLSX, media processing and Meet/WebRTC
  load only when the matching surface or feature is opened.
- The complete initial static JavaScript graph for shell, router and platform
  is capped at 200 KiB gzip. The implementation gate traverses the generated
  build graph and measures its compressed bytes; it does not depend on hashed
  filenames or a hand-maintained `manualChunks` table. The current graph was
  measured at about 173 KiB gzip on 2026-09-15.

### Tests and ownership

- Unit and contract tests stay beside their code under `src/shell`,
  `src/platform` and `src/apps/drive/files`. Browser journeys live under
  `e2e/unified-frontend/shell` and `e2e/unified-frontend/files`; platform
  browser behavior is exercised through those user-visible surfaces.
- The unified-frontend test project is zero-red. The legacy Vitest job uses an
  exact, shrinking failure manifest rather than a numeric allowance. Its
  initial entries are the 57 failing Slides assertions and Writer's
  `docximporter.test.js` collection error caused by unresolved `mammoth` on
  2026-09-15. Any new failure fails the job; a recovered baseline entry must be
  removed.
- `@netchampfaris` owns `frontend/src/composition`, `src/shell`,
  `src/platform`, architecture enforcement and shell browser journeys.
  `@BreadGenie` and `@netchampfaris` jointly own all Drive paths, including
  `index.ts`, `files`, `legacy` and Files browser journeys. Encode these paths
  in `CODEOWNERS`. A public product-interface change also requires review from
  at least one affected consumer owner under ARCHITECTURE.md rule 9.
