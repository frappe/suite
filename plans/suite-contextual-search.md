# Suite Contextual Search

> **Status**: IN PROGRESS - initial shell-owned palette implemented; retrieval
> and mobile follow-ups remain.
>
> **Decided on**: 2026-08-27
>
> This document records the agreed search direction so it can be referenced
> during implementation. Revalidate the current implementations before each
> follow-up slice.

## Implementation Status

Implemented on 2026-08-27:

- One shell-mounted command palette and one global `Mod+K` shortcut.
- Suite app navigation filtered through the existing app-switcher permissions.
- Debounced, cancellable Drive search using the existing authorized endpoint.
- A shared reactive command registry with automatic owner cleanup.
- Contextual Drive navigation, folder creation, and file upload commands.
- Mail Advanced Search and existing Sheets editor commands registered with the
  global palette while their owning surfaces are mounted.
- Drive's sidebar Search control opens the global palette.
- Mail, Calendar, and Meet sidebar Search controls open the global palette and
  show its platform-specific keyboard shortcut.
- The old Drive and Mail `Cmd/Ctrl+K` listeners and Sheets-local palette were
  removed.
- Focused registry tests, full frontend tests, production build, and desktop
  browser smoke checks pass.

Deliberately deferred:

- The two-character trigger. The existing MariaDB FULLTEXT index does not make
  short-token behavior a portable contract, so v1 currently retains three
  characters.
- Typo-tolerant Drive retrieval and metadata/location matching. These require a
  measured indexing design rather than broad SQL or client-side ACL filtering.
- Authorization inside the candidate query. The existing endpoint filters
  effective access on the server after bounded candidate retrieval.
- Current-folder result boosting, parent breadcrumbs, local interaction
  history, and recent children.
- A purpose-built full-screen mobile presentation.
- Cross-app invocation of Mail Advanced Search while Mail is not mounted.

## Goal

Give every Suite app one predictable `Cmd/Ctrl+K` experience that helps users
navigate from their current context. The palette should combine contextual
actions, Suite navigation, and high-confidence content results without becoming
a full search application.

## Product Model

- The Suite shell exclusively owns `Cmd/Ctrl+K`.
- The palette opens from every Suite app.
- The active object is the strongest empty-state context, followed by the
  current app and then Suite-wide destinations.
- Context biases typed-query ranking but never constrains it. Strong matches
  from outside the current context remain discoverable.
- Visible scope chips and power-user keywords let users deliberately narrow or
  redirect a query.
- Results are grouped by intent rather than blended into one opaque score.
- Mobile presents the same capabilities in a keyboard-safe full-screen search.
- There is no dedicated deep-search page in v1. The palette is the complete
  Drive search experience.

## V1 Scope

The first release provides a global shell with Drive as its only content-search
provider.

Suite-wide capabilities:

- App and route navigation.
- Contextual navigation and create commands.
- A single global shortcut and keyboard interaction model.
- Mail registers an action that opens Advanced Mail Search.
- Sheets registers its existing contextual editor commands.

Drive capabilities:

- Search accessible files and folders by name and key metadata.
- Show navigation and create actions, but no mutation actions.
- Create Folder, Writer, Sheet, and Slide in the active Drive folder when that
  destination is valid.
- Show recent children based on local interaction history.

Explicitly excluded from v1:

- Cross-app content search.
- Document-body indexing.
- A full-results route, pagination, or infinite scrolling.
- Rename, move, share, delete, and permission-management commands.
- Server-synchronized personalization history.

## Palette Behavior

### Empty State

Present, in order:

1. Navigation and create actions for the active object or folder.
2. Recently opened children.
3. Current-app destinations.
4. Suite-wide app navigation.

### Typed State

- Keep commands and navigation available immediately.
- Begin remote Drive search after two characters with a short debounce.
- Present compact intent groups such as Suggested, Drive, Navigate, and
  Commands.
- Show roughly 10-20 high-confidence matches and ask the user to refine when
  necessary. Do not paginate inside the palette.
- `Enter` opens the selected destination in the current tab.
- `Cmd/Ctrl+Enter` opens it in a new tab.

### Scope

Use both visible scope controls and query syntax. Exact vocabulary remains an
implementation decision, but expected forms include an app scope such as
`drive:` and a location scope such as `in:folder`.

## Drive Retrieval

V1 matches:

- File and folder names.
- Type.
- Owner.
- Parent location.

Matching should prioritize exact and prefix name matches, then tolerate modest
misspellings. Semantic or embedding-based retrieval is not part of v1.

Ranking priorities are:

1. Text relevance.
2. Active folder or object context.
3. Local interaction history.
4. Modification recency.

Each result shows its type and a compact parent breadcrumb. Show owner only when
the item is shared or it helps distinguish duplicate names.

Authorization must be enforced inside the backend query. The client must never
receive broad results and filter inaccessible entities itself. The executable
plan must reconcile this requirement with Drive's current effective-access and
pagination implementation.

## Architecture Direction

Use a shared provider registry instead of app-owned global keyboard listeners.
Each app provider should be able to contribute:

- Availability based on route and active context.
- Empty-state items.
- Query results.
- Commands, aliases, and scope keywords.
- Permission and disabled-state information.
- Navigation behavior.
- Mobile presentation metadata.

The shell owns:

- Shortcut registration and editable-element exclusions.
- Palette open state and focus restoration.
- Arrow, Enter, modified-Enter, and Escape behavior.
- Query lifecycle, cancellation, and stale-result handling.
- Grouping, ranking, result limits, loading, empty, and error states.
- Responsive desktop and mobile presentation.

The provider contract should be designed from the concrete Drive, Mail, and
Sheets integrations rather than speculative future providers.

## Existing Systems Considered

### Suite

- Sheets currently uses `frappe-ui`'s command palette for contextual editor
  commands.
- Drive currently binds `Cmd/Ctrl+K` to a custom filename-search dialog.
- Mail currently binds `Cmd/Ctrl+K` to advanced domain search.
- Writer uses `Cmd+Shift+K` for document search.
- Other Suite apps have app-local search controls or no global search surface.

The global shell must replace conflicting shortcut ownership while preserving
Mail's advanced search and Sheets' editor commands as registered capabilities.

### Gameplan

Gameplan combines fast local fuzzy navigation with debounced authorized backend
search and offers a bridge to broader search. Useful lessons are local-first
responsiveness, contextual result labels, and permission-aware backend queries.
Its recency-dominant ranking and non-durable full-search state should not be
copied.

### Raven

Raven cleanly separates quick navigation and commands from rich contextual
message/file search. Useful lessons are grouped intent, already-loaded local
providers, canonical destination URLs, responsive modality, and contextual
actions. Its shallow substring ranking and unpaginated backend retrieval should
not define Suite's relevance model.

## Success Measure

The primary metric is successful destination rate: the proportion of palette
opens that lead to an item, command, or app destination.

Supporting signals:

- Time from palette open to destination.
- Query reformulation rate.
- Abandonment rate.
- Selected result position and group.
- Keyboard versus pointer completion.
- Local and remote result latency.

Instrumentation must avoid recording sensitive query text or file metadata by
default.

## Implementation Planning Needed

Before execution:

1. Audit shortcut mounting and shell lifecycle in the current frontend.
2. Define the smallest provider contract using Drive, Mail, and Sheets.
3. Measure the current Drive search query, indexes, permission filtering, and
   representative latency before selecting a typo-tolerance implementation.
4. Specify ranking weights, tie-breaking, result cap, debounce, and cancellation
   behavior with test fixtures.
5. Define local-history retention, limits, invalidation, and privacy behavior.
6. Prototype desktop and mobile focus, keyboard, IME, and screen-reader flows.
7. Add focused backend authorization and ranking tests plus frontend shortcut,
   grouping, navigation, and stale-result tests.

## Open Implementation Questions

- Whether the existing `frappe-ui` command palette can meet filtering,
  accessibility, and responsive requirements or needs focused enhancement.
- Which Drive metadata fields should be free-text searchable versus exposed as
  structured scopes.
- Which typo-tolerant search mechanism fits the existing database and indexing
  constraints.
- How active selection and current-folder context are exposed to the shell
  without coupling it to Drive internals.
- How Mail's modal and Sheets' commands register without loading entire app
  bundles eagerly.
- Whether local interaction history stays browser-local permanently or later
  becomes an authenticated, cross-device capability.
