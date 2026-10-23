# Suite coding standards

How code in this repository is written. The rules come from the code the Drive
rewrite and the unified frontend already follow: `suite/drive/`,
`frontend/src/apps/drive/{client,files}/`, `frontend/src/platform/`,
`frontend/src/shell/` and `frontend/src/composition/`. New and rewritten code
follows them. Untouched legacy code is brought in line when its owner works
there.

Related documents, each with one job:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) owns module placement, dependency
  direction and public-interface rules. This file does not repeat them.
- `suite/<product>/CONTEXT.md` and [`CONTEXT-MAP.md`](./CONTEXT-MAP.md) own
  each product's vocabulary. Names in code come from there.
- `specs/`, `wayfinder/` and `suite/<product>/docs/adr/` own behaviour and
  decisions. Code comments cite them by section (`§11.2`).

A rule marked **Target** is one the repository does not meet everywhere yet.
Each names the check that tracks the gap. New code meets the target; do not add
to a baseline.

## Shared rules

1. **Deep modules.** A module has one small interface and does substantial work
   behind it. The interface is `suite/<product>/__init__.py` in Python and
   `apps/<product>/index.ts` in the frontend. Export a name only when a
   production caller needs it; an internal test is not a reason.
2. **Callers ask for outcomes, not steps.** `drive.create_document(...)` writes
   the node and the document, checks the role, charges the quota and records
   activity. A caller never composes those steps or repeats an invariant the
   module owns.
3. **Names come from the domain language.** Use the term the product's
   `CONTEXT.md` gives and avoid the terms it lists under _Avoid_. The same noun
   travels unchanged from the database column to the HTTP field to the
   TypeScript type (`trash_root`, `content_doctype`). Transport and storage
   words (`row`, `payload`, `data`) stay out of interfaces.
4. **Types make wrong states unrepresentable.** Model a set of allowed values as
   a literal union or a constant ladder, a fixed shape as a `TypedDict`,
   `interface` or frozen `dataclass`, and an absent value as `None` /
   `undefined` with a typed alternative, not a sentinel string. Wrong states
   are refused where a value enters the module, once.
5. **YAGNI.** No seam without two real adapters. No helper for one caller. No
   `utils`, `common`, `helpers` or `shared` module as a home for code without
   an owner. Similar code stays duplicated when the domain rules differ.
6. **Comments say why.** A file or module starts with a short statement of its
   job and the rules that hold across it. A comment explains a decision, a
   constraint or a framework quirk and cites the spec section; it does not
   restate the code. Update or delete a comment when the code it describes
   changes. No commented-out code.
7. **The server decides.** Permissions, quota and validation are enforced in a
   workflow on the server. The client hides what the server would refuse, and
   nothing more.
8. **Few broad tests through the real interface.** Test observable behaviour
   against an expectation written independently of the implementation. Name
   a test as the sentence it proves. Fake the boundary (the network, the
   database) rather than the module's own internals. Delete a test that only
   mirrors the code.
9. **Every user-facing string is translated** with `_()` in Python and `__()`
   in the frontend, written in sentence case.
10. **Debt is explicit.** Every architecture check (`suite/tests/test_architecture.py`,
    `frontend/scripts/check-import-boundaries.mjs`) carries an exact baseline
    whose entries name an owner and a removal condition. The count baselines
    under `frontend/baselines/` (ESLint errors, out-of-scope type errors,
    untranslated text) and the mypy `ignore_errors` list in `pyproject.toml`
    follow the same rule. The baseline shrinks; a new violation fails the
    check, and so does a fix that leaves its entry behind (run the check with
    `--update-baseline`).
11. **Commit subjects** read `<area>: <Sentence>`, where the area is a product
    or layer name: `drive: Keep a file's extension when renaming`,
    `shell: Mount the command palette`.

## Python backend (`suite/`)

### Package layout

A product package is laid out as Drive is:

```text
suite/<product>/
├── __init__.py        public interface: facade functions, exported errors, __all__
├── CONTEXT.md         domain language
├── _core/             private workflows, one module per concern (nodes, access, quota)
├── framework.py       Frappe permission/query hooks; every dotted hook target ends here
├── jobs.py            scheduler entry points
├── http/
│   ├── translator.py  the route table and the before_request hook
│   ├── routes.py      one whitelisted handler per route
│   └── shapes.py      TypedDict response shapes and query-string coercion
├── doctype/           persistence; controllers validate their own row only
├── patches/
└── tests/             test_<module>.py and fixtures.py
```

- `__init__.py` is the only import path for code outside the package:
  `from suite import drive`. Its module docstring documents what the interface
  promises: errors by type, transaction behaviour, permission requirements and
  the cost of each call (`suite/drive/__init__.py`).
- A facade function collects the caller's context, calls one `_core` workflow
  and returns the documented result. It imports its workflow inside the
  function, so importing the package is cheap.
- A product teaches Drive about itself in its own `drive.py` adapter
  (`suite/writer/drive.py`), never from inside Drive.

### HTTP endpoints

- A resource URL is `/api/suite/<owner>/<resource>`, plural nouns, verbs from
  HTTP: `GET /nodes/{node}`, `PATCH /nodes/{node}`, `POST /nodes/{node}/copy`,
  `PUT /nodes/{node}/grants/{principal:path}`. A row that exists is addressed
  by its id (`PATCH /grants/{grant}`), never by rebuilding a key that is also
  a secret. A listing answers `{rows, next_cursor}`. The owner table is
  registered in `suite/composition/registrations.py`.
- The route table is data: one `Route(method, path, handler, body=, query=,
  output=, errors=, allow_guest=, stream=)` per row in `http/translator.py`
  (`suite/composition/http.py` defines `Route`). Every row declares what
  travels, because the contract is generated from it: a `body` on every
  POST, PUT and PATCH (`Empty` when nothing is sent); a `query` on a GET or
  DELETE that takes arguments (a DELETE never has a body); an `output`; and
  the refusals it may answer, at least one on every row with a path
  parameter. `stream=True` marks a row whose bytes are not JSON: a PUT that
  receives raw bytes declares no body, and a GET that sends them no output.
  A route with several bodies declares a union of `TypedDict`s
  (`Rename | Move | Trash`; one per `kind` on `POST /nodes`), and the
  generated client exposes one operation per member.
- Three answer shapes recur. A write that creates or changes one resource
  answers that resource's shape. A write that removes or touches rows
  answers `{count}` (every DELETE, a purge, a visit, a read receipt). A
  listing answers a cursor page.
- A handler does four things: declares `@frappe.whitelist(allow_guest=...,
  methods=[...])`, builds principals once, calls one workflow, shapes the
  answer. It parses nothing else and decides no policy. `allow_guest` means a
  caller without a session may reach the route; whether they may act is the
  workflow's decision.
- Response shapes are `TypedDict`s in `shapes.py`. One serialiser answers a
  list row and a detail fetch, so the two cannot drift. Query-string values
  are coerced inside the handler body with the `shapes` helpers
  (`required_text`, `whole`, `flag`), so a bad value is a 400 with a message.
- Clients never name bytes. No route accepts a blob id, a storage key or a
  byte count as an instruction; bytes arrive through an upload session.
- The route table is exported as `frontend/src/apps/<owner>/client/contract.json`
  by `suite.composition.contract.write_all`, and `yarn generate:contract`
  turns that into `generated.ts`. Change the table, regenerate both, commit
  all three.

### Errors

- A product declares one base error that subclasses `frappe.ValidationError`
  and carries `http_status_code`, and one subclass per refusal
  (`suite/drive/_core/errors.py`). Callers catch by type, never by message.
- Workflows `raise`. The HTTP boundary (`_route` in `http/routes.py`) throws
  the same class again so the v2 envelope carries the class name and the
  message, and maps a plain `frappe.ValidationError` (a malformed argument)
  to the base error at 400.
- A caller below READ gets 404, not 403, so an unreadable item stays
  invisible.

### Transactions and permissions

- A workflow opens a savepoint, rolls it back with `rollback_savepoint` on any
  failure and never commits. The caller's transaction decides when to commit.
  Scheduler jobs commit per item and roll back a failed item on its own.
- Lock order is part of the interface and is written in the facade docstring.
- A request's identity is built once as a `Principals` value
  (`framework.principals_for_request()`) and passed down. Workflows call
  `access.require(row, role, principals)`; nothing re-derives identity from
  `frappe.session` lower down.
- Roles are an ordered integer ladder (`roles.py`), exported as constants.
- Business validation and permission checks live in workflows. Do not fix a
  workflow by passing `ignore_permissions=True`. Test permission-sensitive
  behaviour as a normal user, not only Administrator.

### Style

- Ruff formats and lints: `line-length = 110`, double quotes, spaces, rules
  `F E W I UP B RUF` (`pyproject.toml`). `ruff format --check .` and
  `ruff check .` both fail CI, at the version pinned in
  `.pre-commit-config.yaml` and `suite-linter.yml`.
- mypy type-checks `suite/drive` and `suite/composition` (`[tool.mypy]` in
  `pyproject.toml`; run `mypy` from the app directory inside a bench). Tests
  and patches are excluded. **Target:** an empty `ignore_errors` module list.
  Remove a module from it when `mypy` reports nothing there; never add one.
- Annotate every signature: `-> None`, `str | None`, keyword-only arguments
  after `*` for anything a caller could confuse. Use `Mapping` for read-only
  inputs and a frozen `dataclass` for a value with several fields.
- SQL lives in module-level constants with named `%(param)s` placeholders.
- Docstrings: one imperative line stating what the call answers, then
  paragraphs for the non-obvious: why the shape is what it is, what it
  refuses, which spec section decided it.
- `frappe.throw(_("..."))` in DocType controllers; raise the product error in
  workflows.

### Tests

- `suite/<product>/tests/test_<module>.py`, run with
  `bench --site <test-site> run-tests --module suite.<product>.tests.test_<module>`.
- `IntegrationTestCase` when the test needs the site; `UnitTestCase` when the
  boundary under test can be stubbed (`suite/drive/http/tests/test_routes.py`
  patches the workflow to test the refusal mapping).
- Shared fixture helpers go in `tests/fixtures.py`; site-wide helpers such as
  `ensure_user` in `suite/tests/utils.py`. A fixture cleans up what it made.
- Test names are sentences: `test_unreadable_is_not_found`,
  `test_a_malformed_site_default_is_refused_not_read_as_unlimited`.
  Use `subTest` for a table of cases.
- Workflow behaviour is tested through the interface callers use. Adapter
  tests (HTTP, WebDAV) test translation, not policy.

## Frontend (`frontend/src/`)

### Layers and folders

```text
frontend/src/
├── platform/<module>/index.ts   product-neutral: transport, server-state, session,
│                                theme, translation, feedback, page-meta, realtime
├── shell/                       rail, launcher, settings dialog, account
├── composition/                 wires products into the shell: routes, registries
└── apps/<product>/
    ├── index.ts                 the only path another product or composition imports
    ├── client/                  server contracts: generated.ts, api.ts, policy.ts,
    │                            lazy validators and named product workflows
    └── <area>/                  one area of the product (Drive: files/)
        ├── pages/               route components and routes.ts
        ├── features/            UI behaviour; a subfolder per feature (share/, trash/, uploads/)
        └── internal/            pure helpers with no Vue or network (format, filename, slugify)
```

- `platform/<module>/index.ts` is the module's whole interface, with
  `index.test.ts` beside it. A platform module imports nothing from `shell`,
  `composition` or `apps`.
- A product imports its own code, `@/platform/*` and other products' package
  roots `@/apps/<other>` only. Shell imports shell and platform. Composition
  imports shell, platform and product roots. `check-import-boundaries.mjs`
  enforces this.
- `apps/<product>/index.ts` exports a small, documented surface: the
  `AreaDefinition`, lazy components (`defineAsyncComponent`), composables with
  a `/** ... Call it in a component's setup. */` note, and the `Pick<>` types a
  consumer needs. It does not re-export internals.
- No frontend code calls a `suite.drive.api.*` method. Drive is reached
  through `apps/drive/client/` and the `/api/suite/drive/` routes only.

### Files and names

- Vue components are `PascalCase.vue`. Everything else is `camelCase.ts`.
- A file is named for what it exports: a pure module after its noun
  (`selection.ts`, `nodeActions.ts`, `format.ts`); a composable `useX.ts`
  only when it needs a component's setup (`useTrashActions.ts`,
  `useShare.ts`). A test sits beside its subject as `<name>.test.ts`.
- Generated catalog paths use nouns for groups and verbs for commands
  (`api.drive.nodes.get`, `api.drive.nodes.rename`).
- Constants are `UPPER_SNAKE` (`LINK_CAP`, `UNDO_DURATION`). Server field
  names stay `snake_case` in TypeScript types because they are the wire
  format; local names are `camelCase`.

### Typing

- `strict: true`. Avoid `any`, including generic plumbing and generated code. No `as` cast where a type guard or a narrower parameter
  type (`Pick<DriveNode, 'access'>`) does the job. No `!` where the type can
  carry the fact.
- `interface` for an object shape, `type` for a union or alias. Inputs are
  `readonly` arrays. Validators are `asserts value is T`.
- Server shapes come from `client/generated.ts` and `client/types.ts`; a
  component types its props with them, not with a copy.
- **Target:** every folder under strict typecheck. `tsconfig.typecheck.json`
  lists the folders `yarn typecheck` fails on; add a folder there when it is
  clean. Errors outside the list are counted per file in
  `baselines/typecheck.json`, which only shrinks.

### Vue components

- `<script setup lang="ts">`. Props as `defineProps<{ ... }>()`, with
  `withDefaults` only when a default is needed. Two-way state with
  `defineModel<boolean>('open', { required: true })`. Typed emits
  `defineEmits<{ renamed: [node: DriveNode] }>()`. Template refs with
  `useTemplateRef`.
- A dialog is opened by function call (`presentDialog`, `useDriveDialogs`),
  renders inside the caller's app context and resolves with its result. Other
  products never render a product's dialog component themselves.
- Module state is a factory plus a singleton: `createTheme()` for tests,
  `useTheme()` for the app (`platform/theme`, `platform/session`,
  `platform/server-state`). No Pinia in unified code.
- Lazy-load anything not needed for first paint: `defineAsyncComponent`,
  `() => import(...)` in routes and heavy helpers. `yarn check:bundle-budget`
  caps the initial JavaScript graph at 200 KiB gzip.

### Server state

- Ordinary requests import `api`, `client`, and composables from `@/api`.
  Pass a generated reference and typed arguments. Do not construct descriptors,
  transport operations, request wrappers, or per-call policies.
- `useQuery(reference, input)` and `useInfiniteQuery(reference, input)` accept
  a value, ref, or getter. `false` disables the observer and its refetch.
- `client.query` reads fresh by default. `{ cache: 'prefer' }` permits a fresh
  cached answer. Both caller forms share cache, flights, entities, and effects.
- Backend route metadata declares kind, public name, page fields, and bytes.
  Generated references expose these facts. Owner policies declare scope,
  membership, optimism, and effects. Composition loads policies and validators
  only when the owner is used.
- Every mutation declares effects or explicit `none`. The catalog coverage test
  rejects missing decisions and invalid reader IDs.
- Access partitions contain opaque identities. Never put credentials in keys
  or persisted entities. Editor sessions use Drive's reusable credential
  context for document and composite-group calls.
- Keep transfer, editor save, and creation workflows in their products.
  Collaboration, media bytes, offline pinning, and identity bootstrap have
  explicit protocol boundaries. Do not add ordinary calls to those boundaries.
- Direct `transport.request` is internal to transport and these recorded
  boundaries. `createResource`, `useDoc`, and descriptor builders are removed
  from ordinary production callers.

### Errors and feedback

- A failed request is a `TransportError` with `type` (the server's error class
  name, `DriveRestoreDestinationRequired`) and `status`. Branch on `type`,
  never on the message.
- Awaited queries and mutations reject on failure. `mutation.run()` also sets
  `mutation.error`. Success UI runs only after the awaited command succeeds.
  The default error toast is on; pass `{ silent: true }` when the component
  shows the refusal itself (under a field, or as a toast with Retry).
- Vue event handlers can await a mutation without a local catch when they need
  only default feedback or an inline `mutation.error`. Return or await the
  promise so Vue owns its rejection. Reset inline error state when the dialog
  context changes. Keep local handling for recovery, partial results, and
  background work that Vue does not await.
- Async menus use `Dropdown` and `ContextMenu` from `@/platform/feedback`.
  They preserve Frappe UI behavior and report callback rejections through the
  application's error handler. `AdaptiveDropdown` uses this adapter on desktop
  and returns the action promise from its mobile event handler.
- User feedback goes through `@/platform/feedback`: `toast`, `confirm`,
  `prompt`. A destructive action confirms first; a reversible change reports
  in a toast with Undo (`features/changeToast.ts`).

### UI

- Use frappe-ui components (`Button`, `Dialog`, `FormControl`, `Dropdown`,
  `ListView`) from `'frappe-ui'` and semantic tokens (`text-ink-gray-8`,
  `bg-surface-gray-2`, `border-outline-gray-1`). No raw palette colours, no
  `frappe-ui/experimental` or `frappe-ui/src/` imports (checked, with a
  baseline). Load the `frappe-ui` skill before styling.
- Icons are Lucide, as `lucide-<name>` classes or `~icons/lucide/<name>`.
- Interactive elements carry an accessible name (`aria-label="Select all"`);
  tests select by it.
- **Target:** every string a user reads goes through `__()` from
  `@/platform/translation`. `yarn check:untranslated` counts bare template
  text and user-facing attributes (`label`, `placeholder`, `title`,
  `aria-label`, ...) per file in `baselines/untranslated.json`, which only
  shrinks. It cannot see strings built in `<script>` (toast titles, confirm
  messages); review those by hand.

### Tests

- Vitest, jsdom, colocated `*.test.ts`. The `unified` project runs the strict
  folders; `yarn test <file>` runs one file.
- Fake the boundary: stub `globalThis.fetch` with a small in-memory server
  that keeps state (`features/trash/useTrashActions.test.ts`), or pass a fake
  `Transport` into `createApiClient` (`client/nodes.test.ts`). Mock a module
  only when it is pure side effect, such as `@/platform/feedback`.
- Mount with `createApp` and `h`, assert through the DOM a user sees (roles,
  labels, text), and unmount in `afterEach`. Pure modules are tested as
  functions.
- End-to-end tests are Playwright specs under
  `e2e/unified-frontend/<area>/specs/<behaviour>.spec.ts`. They create their
  data through the HTTP API with the `helpers/` module, tag it with
  `runTag()`, and purge it in `afterEach`.

### Formatting and lint

- Prettier formats the frontend (`frontend/.prettierrc`): frappe-ui's
  settings (two-space indent, single quotes, no semicolons, trailing commas)
  at 100 columns. `@ianvs/prettier-plugin-sort-imports` orders imports as:
  Node builtins and libraries, blank line, `@/` modules, blank line, relative
  imports. `yarn format` writes, `yarn format:check` fails CI, and the
  pre-commit hook formats staged files. Generated files and Markdown are
  ignored (`.prettierignore`).
- ESLint (`frontend/eslint.config.js`: `eslint-plugin-vue` recommended,
  `@vue/eslint-config-typescript` recommended, layout rules off) checks
  correctness. `yarn lint` compares errors to `baselines/eslint.json`, keyed
  `file|rule`; warnings are advisory and `yarn lint:fix` clears the fixable
  ones. The pre-commit hook autofixes staged files and compares only their
  baseline entries; CI runs the whole tree. **Target:** an empty ESLint
  baseline; `no-explicit-any` and `vue/block-lang` (a `<script>` without
  `lang="ts"`) are most of it.
- **Target:** the first `yarn format` over the tree has not landed yet, so
  the `yarn format:check` CI step is `continue-on-error` until the reformat
  commit in `.git-blame-ignore-revs` exists.

## Checks

Frontend commands run from `frontend/`; `knip` runs from the repository root;
Python commands run from the app directory inside a bench. A count baseline
lives under `frontend/baselines/` and is rewritten by the check's
`--update-baseline` flag.

| Check | Command | Scope |
|---|---|---|
| Python format | `ruff format --check .` | enforced |
| Python lint | `ruff check .` | enforced |
| Python types | `mypy` (`suite/drive`, `suite/composition`) | module list in `pyproject.toml` only shrinks |
| Architecture (imports, Drive table writes) | `bench --site <site> run-tests --module suite.tests.test_architecture` | exact baseline |
| Backend tests | `bench --site <site> run-tests --app suite` | enforced |
| HTTP contract, Python to JSON | `bench --site <site> execute suite.composition.contract.write_all`, then `git diff` | enforced in the backend CI job |
| HTTP contract, JSON to TypeScript | `yarn check:contract` | enforced |
| Frontend format | `yarn format:check` | enforced once the first reformat lands; `continue-on-error` until then |
| Frontend lint | `yarn lint` | errors: count baseline; warnings advisory |
| Untranslated text | `yarn check:untranslated` | count baseline; CI only, no pre-commit hook |
| Frontend types | `yarn typecheck` | folders in `tsconfig.typecheck.json` enforced; elsewhere count baseline |
| Import boundaries, unstable frappe-ui, legacy calls | `yarn check:import-boundaries` | exact baseline |
| Bundle budget | `yarn check:bundle-budget` | 200 KiB gzip |
| Frontend tests | `yarn test`, `yarn test:unified` | enforced |
| Dead code | `yarn knip:frontend --exclude exports,types` | enforced once the current findings are fixed; `continue-on-error` until then |
| Unused exports and types | `yarn knip:frontend --include exports,types` | target; runs, does not fail CI |
