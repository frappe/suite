# Implementation map: Home, Files and document hosting

Status: in progress, started 2026-09-15. Orchestrated by the Claude session
on branch `forge/wayfinder-unified-frontend`; codex agents execute the work
packages below. Source of truth for behavior stays in the ticket resolutions
named by [`HANDOFF-home-files-implementation.md`](HANDOFF-home-files-implementation.md).
This file fixes the seams the packages share so they can run in parallel.

## Layout (decided by ticket 013)

```text
frontend/src/
├── composition/        # appRegistry, routes, documentRegistry, DocumentHost, Home
├── shell/              # rail, contextual panel, content pane, mobile nav, sheet
├── platform/           # session, transport, server-state, realtime,
│                       # translation, theme, page-meta, feedback
└── apps/
    ├── drive/
    │   ├── index.ts    # the only cross-product seam
    │   ├── client/     # descriptor modules + generated contract
    │   ├── files/      # new Files area: pages, features, internal
    │   └── legacy/     # today's /drive UI, deletable as one unit
    ├── writer|sheets|slides/index.ts  # DocumentTypeDefinition
    ├── mail/index.ts                  # useInboxSummary()
    ├── calendar/index.ts              # upcoming events descriptor
    └── meet/index.ts                  # room + scheduled-meeting mutations

suite/
├── composition/http.py          # one before_request dispatcher, Route type
├── composition/contract.py      # contract JSON exporter
├── api/routes.py                # Suite-owned table: account, site, users, invitations
├── drive/http/                  # Drive table (reference implementation)
├── mail/http/ calendar/http/ meet/http/   # product tables and handlers
└── composition/tests/http_conformance.py  # executable conformance kit
```

Dependency direction (enforced by `frontend/scripts/check-import-boundaries.mjs`):

```text
composition -> shell, platform, @/apps/<product> package roots
shell       -> platform
products    -> platform, allowed product package roots
platform    -> nothing above
files       -X-> legacy
```

Home lives in `composition/home/` because it composes product seams. The
notifications bell lives in `composition/notifications/` and the shell mounts
it through a slot; the shell itself never imports a product.

## Shared contracts

### Route metadata (ticket 001)

```ts
interface RouteMeta {
  area?: string                       // rail + panel context
  frame: 'area' | 'document' | 'none'
  scroll: 'shell' | 'content'
  allowGuest?: boolean
  title?: string
  favicon?: string
}
```

Routes: `/home`, `/files`, `/files/organization`, `/files/f/:node/:slug?`,
`/files/recent`, `/files/starred`, `/files/shared-with-me`, `/files/trash`,
`/d/:node/:slug?`, `/l/:token` (gated by 011, mount a placeholder that
explains it is unavailable), `/` -> `/home`. Legacy `/drive/**`, `/writer/**`,
`/sheets/**`, `/slides/**`, `/mail/**`, `/calendar/**`, `/meet/**`, `/suite`
keep their current placeholders.

### Area definition (ticket 002)

```ts
type PlatformCapability = 'jmap' | 'systemManager'
interface AreaDefinition {
  id: string
  label: () => string                  // translated
  icon: Component
  to: string                           // canonical entry route
  loadRoutes: () => Promise<{ routes: RouteRecordRaw[] }>
  loadPanel: () => Promise<Component>
  requires?: PlatformCapability[]
}
```

`composition/appRegistry.ts` owns order, capability filtering and the badge
source per area (`useInboxSummary` for Mail). Nothing else is on the interface.

### Document type and session (ticket 009)

```ts
interface DocumentTypeDefinition {
  contentDoctype: string               // 'Writer Document' | 'Spreadsheet' | 'Presentation'
  newLabel: () => string
  icon: Component
  loadSurface: () => Promise<Component> // receives prop `session: DocumentSession`
}
```

`DocumentSession` is defined in `frontend/src/apps/drive/index.ts` (Drive
owns it). Its members follow ticket 009: node id, contentDoctype,
contentDocname, reactive title/state/access, `rename`, `share`, `copy`,
comments and versions operations, `media(id)` handles, `credentials`
grouper, `refreshAccess`, `dispose`.

### Session (ticket 002)

```ts
useSession(): {
  status: Ref<'loading' | 'guest' | 'authenticated'>
  user: Ref<{ id: string; fullName: string; avatar: string | null } | null>
  capabilities: Ref<{ jmap: boolean; systemManager: boolean }>
  login(email, password): Promise<void>; logout(): Promise<void>; refresh(): Promise<void>
}
```

### Server state (reference: `references/server-state-client.md`)

Names are fixed: `useQuery`, `useMutation`, `settled()`, `run()`, `silent`,
`member`, `touches`, `optimistic`, descriptor builders `query`, `infinite`,
`mutation`, `upload`, and `createServerState({ transport })` for tests.
Application code imports only `@/platform/server-state` and
`@/apps/<product>/client/*`.

### Contract JSON (backend -> frontend generator)

`bench --site <site> execute suite.composition.contract.write_all` writes one
`frontend/src/apps/<owner>/client/contract.json` per owner (`suite` goes to
`frontend/src/platform/transport/contract.json`). Shape:

```json
{
  "owner": "drive",
  "prefix": "/api/suite/drive/",
  "operations": [
    {
      "id": "node_patch.rename",
      "method": "PATCH",
      "path": "nodes/{node}",
      "pathParams": ["node"],
      "query": null,
      "body": { "...json schema..." },
      "output": { "...json schema..." },
      "errors": ["DriveForbidden", "DriveConflict"],
      "entity": { "tag": "DriveNode", "id": "name", "version": "modified" },
      "nodeParams": ["node"]
    }
  ]
}
```

Schemas come from `pydantic.TypeAdapter(TypedDict).json_schema()`. A body
union emits one operation per member (`node_patch.rename`, `node_patch.move`).
`frontend/scripts/generate-contract.mjs` turns each JSON into
`client/generated.ts` (`api.<id>` descriptors, input/output types, error
unions). Both files are committed.

### Backend route registration (ticket 003)

`suite/composition/http.py` exports `Route(method, path, handler, body=None,
errors=(), allow_guest=False)` and `handle_before_request()`. It selects the
`<owner>` segment of `/api/suite/<owner>/...` and delegates to the owner's
table, found through a registry in `suite/composition/registrations.py`
(`HTTP_OWNERS = {"drive": "suite.drive.framework.HTTP", ...}`). Drive's
existing translator becomes an adapter to this shape without changing its
behavior; `test_translator.py` becomes the conformance kit in
`suite/composition/tests/http_conformance.py`, run against every owner.

Owner tables required now: Suite (`account`, `site`, `users`, `invitations`),
Mail (`inbox-summary`), Calendar (`events`), Meet (`rooms`,
`scheduled-meetings`). Each is a thin adapter over the same product workflow
the legacy `/api/method/` function calls.

## Work packages

| Id | Package | Depends on | Owner agent |
|---|---|---|---|
| W1-site | dev site at suite.netchamp.dev | none | codex |
| W1-structure | legacy relocation, boundary rules, test projects, budget gate, CODEOWNERS | none | codex |
| W1-backend-composition | dispatcher, Route type, conformance kit, Suite/Mail/Calendar/Meet tables, contract exporter | none | codex |
| W1-backend-drive | Drive asks: roots, group_by, kind filter, batched expansions, search breadcrumbs, folder archive, drive:changed, opened_at, unread count | none | codex |
| W1-platform | the eight platform modules + generator + tests | contract JSON shape above | codex |
| W2-shell | shell, composition registry, routes, unavailable surface, mounting spike | W1-platform, W1-structure | codex |
| W3-files | Files area, Drive client, `@/apps/drive` seam | W2, W1-backend-drive | codex |
| W3-home | Home area, bell, Mail badge, Meet controls | W2, W1-backend-composition | codex |
| W3-documents | DocumentHost, DocumentSession, three surface adapters | W2, W3-files seam | codex |
| W4-verify | browser journeys, bundle gate, accounting against tickets | W3 | codex |

Rules every package follows:

- Change only the paths the package owns. Do not commit; the orchestrator
  commits per package.
- No legacy RPC fallback in new code. A missing route is implementation work.
- Gated by open tickets 007, 008, 010, 011, 014: leave the control absent or
  render an explicit unavailable state.
- Every package ends with a `Not done:` line naming what it left out and why.

## Decisions made during implementation

- **`/files` collides with Frappe's public upload path.** `frappe serve` wraps
  the app in `StaticDataMiddleware` for `/files`, and frappe-ui's Vite proxy
  forwards `/files` to the bench, so the Files area 500ed on the dev site
  (found 2026-09-15). Resolution, pending Faris's review: keep ticket 001's
  grammar. In dev, `frontend/vite.config.ts` excludes `files` from the
  frappe-ui proxy source and adds a `/files` rule whose `bypass` serves the SPA
  for `Accept: text/html` navigations only; other requests still proxy to the
  bench. In production, nginx serves a real upload first and falls through to
  the new `website_route_rules` for `/home`, `/files`, `/files/<path>` and
  `/d/<path>` in `suite/hooks.py`. Residual risk: a public upload named exactly
  `organization`, `recent`, `starred`, `shared-with-me`, `trash` or `f` would
  shadow that route in production. Alternative if that is unacceptable: rename
  the area prefix (one constant in `composition/routes.ts` plus tests).
