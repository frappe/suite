---
id: 009
title: Content page contract
label: wayfinder:grilling
status: closed
assignee: codex (agent, 2026-09-15)
blocked-by: [002, 005]
---

## Question

Define the contract between the shell and an editor mounted in the content
pane. Writer, Sheets and Slides keep their editors and get new document
pages on the node route. The prototype initially implied that the shell owns
the title bar; this ticket must confirm or supersede that ownership inference.

Settle:

- What the shell passes the editor: node id, content doctype and name from
  the node's identity link, the caller's role, the document's link codes.
- What the editor gives the shell: title and rename, save and sync state,
  read-only and refused states from the collab server (spec §6.7), a share
  action, comments and version panel triggers, presence.
- Document creation through the generic Drive workflow only
  (ARCHITECTURE.md rule 8.6): New menu items, templates (§8.10), copy.
- Media: node ids and signed `/f/` URLs (§6.8) with the 15-minute lifetime
  refreshed at ten minutes; pinned caching by signature-free blob key;
  Slides composites loaded in groups under the 20-code cap with ordered
  unreadable placeholders (§6.6).
- Versions and comments as Drive tables (§9.1, §9.3) rendered by shared
  panels versus per-editor panels.
- Mounting: the editor's own scroll ownership, full-pane sizing for the
  Sheets canvas and Slides stage, and leaving the editor by the rail.
- The old editor pages (`/writer/d/<id>`, `/sheets/...`, `/slides/...`)
  during grow-beside.

Inputs: ticket 34 acceptance criteria; Drive spec §6.6 to §6.8, §8.10,
§9.1, §9.3, §10; `frontend/src/apps/writer/pages`,
`frontend/src/apps/sheets/pages`, `frontend/src/apps/slides/pages`.

## Resolution

- Composition owns one generic `DocumentHost` for the canonical
  `/d/<node-id>/<decorative-slug>` route. It opens a live Drive-owned
  `DocumentSession`, selects a product adapter from the composition registry,
  and mounts that adapter keyed by node id. Moving to another document runs the
  old product's leave guard, disposes both the surface and session, and mounts
  fresh instances; server-state caches may survive that disposal.
- A product adapter renders the complete **Document surface** inside the
  shell's content pane: title bar, editor, save and connection indicators,
  presence, share action, comments and versions panels, and read-only or
  refused presentation. The shell still owns the rail and content-pane
  placement, but it receives no title, save, presence, panel, or other chrome
  state from the product. The adapter interface is one-way: the host supplies
  a `DocumentSession`; the product supplies a lazy surface to mount.
- Every document gets the same full-pane mount box: full width and height,
  zero minimum inline/block size, and hidden host overflow. The product owns
  every internal scroll region and responsive layout, including Writer's
  editor, the Sheets canvas, and the Slides stage and panels. There are no
  product-specific sizing flags or shell branches.
- `DocumentSession` is the Drive frontend's deep interface for an open node.
  It exposes the node id, immutable content doctype and docname, the Drive Node
  title and state, reactive effective access, and Drive-owned operations for
  rename, share, copy, comments, versions, media, and scoped credentials.
  Drive Node `title` is the sole document title; product doctypes do not mirror
  it, and a product title bar renames only through the session.
- The product owns its document body's shape, load and save calls, save/sync
  state, collaboration client, presence model, and recovery format. The host
  never sees Writer HTML, Sheets state, or Slides data. The session gives the
  product the content docname and scoped authorization capabilities needed by
  its private client; it does not wrap product body operations.
- Drive access is the baseline editor mode and a collaboration verdict may
  only narrow it. A downgrade from EDIT freezes new edits immediately and
  cancels or rejects pending writes. Unsaved work is retained as a local,
  explicit recovery copy and is never replayed automatically. A verdict below
  READ unmounts the document content and shows the product's refused surface.
  A trashed document remains read-only as required by the Drive spec.
- While a session is open, access is refreshed after a local share mutation,
  when the window regains focus, and every five minutes. Any authorization
  error or collaboration downgrade restricts the surface immediately. This
  contract adds no Drive access-change socket event.
- Link codes are not a public array on the session. The session offers scoped
  capabilities for REST requests, collaboration authorization, and composite
  grouping; it selects only credentials relevant to the target nodes, includes
  a document's own credential when required, enforces the 20-code limit, and
  returns explicit overflow or refusal errors. Raw codes appear only in the
  final product-private collaboration connection payload.
- Stored document bodies name media by Drive node id. Resolving an id returns
  a stable, reactive media handle with `src`, signature-free `cacheKey`, and a
  loading/ready/refused status. The session fetches the document media set and
  refreshes its 15-minute signed URLs at ten minutes; products own neither URL
  timers nor signature parsing. Pinned copies use the handle's signature-free
  blob key, preserving the Drive spec's cache reuse and revocation window.
- For a composite deck, Slides submits its ordered reference ids to the
  session's credential grouper. The session partitions only the authorization
  material under the 20-code cap; Slides owns its typed composite requests and
  merges each result into the original positions. Groups render progressively:
  every position is content, an unreadable placeholder, a loading placeholder,
  or a failed-group placeholder with retry. One failed group never blocks or
  reorders successful groups, and unreadable references are never omitted.
- Comments and versions remain Drive records and mutations exposed through
  the session, but every product renders its own panels. Anchors, selection,
  version preview and restore presentation remain product-owned; there is no
  generic panel with product slots.
- A product places its own Share button, which calls the session's Drive-owned
  share action. Drive owns and hosts the one share dialog used by Files and all
  document surfaces; products do not import its internal wiring or reproduce
  its permission behavior.
- Each product exports one `DocumentTypeDefinition` through its public
  `apps/<product>/index.ts` seam. The definition contains the content doctype,
  translated New-menu label, and lazy surface loader. Composition owns the
  ordered registry. The host uses it to open documents and Files uses the same
  definition for its New menu and template filter, so no second content-type
  mapping or runtime self-registration exists.
- New, New from template, and Copy always use the generic Drive workflows and
  then navigate to the returned node's canonical `/d/` route. Templates are
  filtered by the definition's content doctype and New from template remains
  Drive copy. New frontend code has no product-specific creation endpoint or
  new-document route.
- Each product surface installs the standard router leave guard. Clean state
  leaves immediately; a save in progress is flushed before leaving; failed or
  unsaved state offers Stay or Leave with a retained recovery copy. Rail links
  remain ordinary router navigation and the shell never queries product save
  state.
- During grow-beside, `/d/` mounts only the new host and surfaces, while every
  legacy Writer, Sheets and Slides URL continues to mount its old page. The new
  surface is never mounted under an old URL. Ticket 014 owns the gated,
  replacement redirects from legacy URLs and deletion of the old pages.

Resolved with the user on 2026-09-15.
