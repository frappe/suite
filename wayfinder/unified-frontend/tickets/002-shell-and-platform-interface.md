---
id: 002
title: Shell and platform interface
label: wayfinder:grilling
status: closed
assignee: codex (agent, 2026-09-11)
blocked-by: [001]
---

## Question

Define the two interfaces every area depends on.

The shell's interface to an area: how an area declares itself (registry
entry: id, label, icon, rail position, route module, panel body, scroll
ownership), what the shell renders around it (rail, contextual panel slot,
page header slot, mobile nav and sheet), and what an open document gets
(panel hidden, a full-pane mount, back on mobile). Ticket 009 owns the title
bar and document-surface seam.

The platform's interface to everything: session and user, the REST client
for `/api/suite/...` (envelope, errors, cursor helper, link-code header),
realtime socket, theme, translation, page meta, toasts and dialogs, feature
flags such as `jmapUser` and `systemUser`. Decide which of these exist today
under `boot/`, `composables/`, `stores/` and `utils/` and move as-is, which
are rewritten, and which stay app-private. Name the import path
(`@/platform/...`) and the rule for entering it (product-neutral, two
consumers).

Inputs: `frontend/src/boot/*`, `frontend/src/shell/*`,
`frontend/src/apps/registry.ts`, the prototype's `ShellLayout.vue` and
`ContextualPanelBody.vue`, ARCHITECTURE.md rule 8, Drive spec §11.1, §11.4,
§11.6, §4.7.

Handed from [frappe-ui shell component gap](004-frappe-ui-shell-component-gap.md)
(2026-09-11): every shell primitive exists at the current pin, so no bump
gates this ticket. frappe-ui's Rail and Sidebar leave scroll regions, fades,
route rules and badges to the app; those are suite wrappers under `shell/`.

## Resolution

- Each product exports its area definition through its public
  `apps/<product>/index.ts` seam. `composition/appRegistry.ts` imports only
  those public definitions, decides availability and ordering, and passes a
  finished registry to the shell. Products do not self-register at runtime,
  and composition does not import their routes, panels, or other internals
  directly.
- `AreaDefinition` contains only `id`, `label`, `icon`, `to`, lazy
  `loadRoutes` and `loadPanel` functions, and optional platform-capability
  requirements. Composition-array order sets rail position; route metadata
  owns frame and scroll behavior; the shell derives mobile navigation from the
  same fields; route metadata owns title and favicon; notification data does
  not enter the area interface.
- The shell owns persistent geometry (rail, contextual-panel
  container, content pane, mobile nav and bottom sheet); an area supplies its
  panel body and declarative page content, while an open document replaces the
  panel with a full-pane mount. Ticket 009 assigns the complete document
  surface, including its title bar, to the product. Freeze the exact CSS seam
  only after a mounting spike proves one shell-scrolling Files page, one
  self-scrolling adopted area, and one full-pane editor on desktop and mobile
  without product-specific shell branches. The mounting spike is the
  implementation gate for the CSS seam, not another product decision.
- Code enters `platform/` only when it is product-neutral and either required
  by shell/composition or used by at least two real products. Product language
  keeps code in the owning product; cross-product use goes through that
  product's public interface. A single product-neutral consumer keeps code
  local until a second consumer exists.
- Rewrite `boot/session.ts` behind one `@/platform/session` interface:
  `useSession()` exposes an explicit loading/guest/authenticated status, the
  Suite identity (`id`, `fullName`, `avatar`), `jmap` and `systemManager`
  capabilities, and login, logout and refresh actions. Remove the parallel
  cookie refs, reactive session object and alternate read helpers as callers
  migrate. Mail accounts, mailboxes, Calendar identities and other product
  profile data remain private to those products.
- Build a Suite-owned, Frappe-semantic server-state engine
  instead of adopting `createResource` or another query library as the
  application abstraction. Its public language is DocTypes, documents,
  document lists, Frappe methods, `modified` versions and realtime document
  events; HTTP paths and response envelopes stay transport details. Keep
  transport, product APIs and server-state coordination as separate layers.
  Prove the engine through a narrow Files vertical slice before making it the
  platform contract for every product; the spike must exercise cached reads,
  stale-while-revalidate, focus refetch, request deduplication, cancellation
  and mutation-driven invalidation. Python dotted paths and raw DocType-name
  strings are transport metadata, never application-facing API; application
  calls must have strictly typed inputs and outputs derived from an
  authoritative server contract.
- The platform owns one app-level UI provider and the product-neutral feedback
  mechanics: toast presentation, generic confirm/prompt behavior, server-state
  challenge hosting, focus containment, stacking and Escape policy. The shell
  owns shell surfaces such as Settings and Account; each product owns its
  domain-specific dialog content, words, state and outcomes. There is no
  central registry of product dialogs, and product components do not enter
  `platform/` merely because the common host can render them.
- `@/platform/translation` owns one catalog load before normal UI mounts. It
  calls Frappe's cached `frappe.translate.get_boot_translations` endpoint
  directly and installs the returned site-wide catalog behind the existing
  `__()`/replacement/context semantics. Frappe already merges every installed
  app, parent-language fallback and user translations, so there are no product
  catalogs to merge and no new Suite facade. The Drive and Mail translation
  wrappers remain only while an old page still calls them during grow-beside;
  the new frontend has no product route loaders for translations, and rollout
  deletes the wrappers with their last legacy callers.
- `@/platform/realtime` owns one lazy singleton Socket.IO connection per
  browser tab to the Frappe site namespace, including host and port discovery,
  session credentials, reconnect behavior and room lifecycle. The server-state
  engine interprets generic document and list events; each
  `apps/<product>/client` owns its product event names and payloads and maps
  them to descriptors. Every subscription returns a cleanup function. There
  is no universal product event bus: Meet SFU signalling and WebRTC,
  Hocuspocus/Yjs, SSE and media streams remain product-private live planes.
- `@/platform/theme` initializes appearance once for the unified frontend and
  exposes the saved mode (`light`, `dark` or `automatic`), resolved mode and
  actions to set or cycle it. It continues to read and write Frappe User's
  existing `desk_theme`, so Suite and Desk share one per-user preference; no
  Suite-only field or device-local preference is introduced. A product may
  apply a scoped presentation override, such as Meet forcing dark during a
  call, but the override never writes the saved preference and restores the
  resolved platform theme when its scope ends.
- `@/platform/page-meta` is the only code that writes browser title and
  favicon. Route metadata supplies the stable fallback title and area favicon;
  the active view may register a reactive title override for live values such
  as a document name, mail subject, unread count or calendar month. The
  platform arbitrates precedence across successful navigation and Vue
  activation, deactivation and unmount, restoring the route fallback when the
  override's scope ends. Product code does not write `document.title` or the
  favicon directly, and the area favicon does not become view-owned metadata.
- Composition evaluates each area's platform-capability requirements once
  against `@/platform/session` and omits unavailable areas from the rail and
  other launch surfaces. The router uses the same evaluator for direct URLs;
  instead of loading the product bundle, redirecting silently or relying on an
  API failure, the shell preserves the URL and renders a product-neutral
  unavailable surface with the reason and applicable next step. Permissions
  within an available area remain product-owned and server-enforced.
- The shell hosts frappe-ui's existing `PageHeaderTarget`; an area page owns
  the Vue content it teleports there. A conventional page may declare
  `PageHeader` and `PageHeaderMobile`, a product with a different header shape
  may use `PageHeaderBase`, and a workspace whose top bars are intrinsic to
  its content layout may declare no shell header. The target is a mounting
  seam, not a Suite header-data schema: the shell owns placement and mobile
  safe-area behavior but never interprets product actions or branches on a
  product id. Ticket 009 resolves document title bars as part of each
  product-owned document surface.
