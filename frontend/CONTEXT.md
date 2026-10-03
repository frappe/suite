# Suite shell

The Suite shell is the frame every product renders inside: one rail, one
area sidebar, one content pane. It is being charted at
[`wayfinder/unified-frontend/MAP.md`](../wayfinder/unified-frontend/MAP.md).
Layout authority is the base prototype named there. Module boundaries follow
[`ARCHITECTURE.md`](../ARCHITECTURE.md) rule 8.

## Language

**Shell**:
The frame around every area: rail, content pane, and on mobile the bottom
nav. The area sidebar belongs to the page, not the shell.
_Avoid_: Layout, App container, Launcher

**Rail**:
The thin always-visible column of area icons plus Notifications, Settings
and the account.
_Avoid_: Sidebar, Nav bar, App switcher

**Area**:
One rail destination with its own routes and content. Home, Drive, Mail,
Calendar and Meet are areas. An open document is not an area; it is
where the shell puts a document.
_Avoid_: App, Product, Module (those name code ownership, not navigation)

**Area sidebar**:
The column beside the rail. The page draws it, not the shell, so a page can
have one, none or its own. On mobile it is the bottom sheet.
_Avoid_: Contextual panel, Drawer, Left nav

**Content pane**:
The main region an area or an open document renders into. Home and Drive
scroll it as a page; Mail, Calendar, Meet and an open document manage their
own scrolling.
_Avoid_: Main, Page, Viewport

**Settings group**:
One product's heading in the Settings dialog, with the tabs under it. Each
product contributes exactly one group, named after the product; the shell
contributes Account and Workspace. The phone shows the same groups as a
drill-in list.
_Avoid_: Settings section, Settings category, Settings modal

**Drive area**:
The area that shows the Drive tree. Its rail label is Drive and its routes
sit under `/drive`. Drive is also the product that owns it; say "Drive area"
when the difference matters.
_Avoid_: Files (the retired area name), My Drive, Home folder

**Drive Root**:
A top-level Drive namespace. A root is either Personal or Shared and is a
location, not a saved view.
_Avoid_: Workspace, Drive space

**Personal Root**:
The Drive Root owned by one user, presented in the Drive area as **My files**.
_Avoid_: Home, Home folder, Personal workspace

**Shared Root**:
The business site's organization-owned Drive Root, presented in the Drive
area as **Organization files**. Personal sites do not have one.
_Avoid_: Everyone, Shared drive, Organization workspace

**Saved view**:
A computed Drive area listing such as Shared with me, Recent, Starred, or
Trash. It
does not own nodes and is not a Drive Root or folder.
_Avoid_: Smart folder, Root

**Upload queue**:
The Drive-owned list of browser uploads in one tab. It survives folder and
area changes, and its progress shows on the Drive rail item.
_Avoid_: Upload manager, Uploader, Upload store

**Interrupted upload**:
An upload whose tab reloaded or closed before it finished. It can resume for
24 hours once the user gives the same file back.
_Avoid_: Paused upload, Failed upload

**Document**:
A content node (Writer, Sheets, Slides, or a previewable file) opened in the
content pane with the panel hidden.
_Avoid_: Editor page, File view

**Document surface**:
The complete product-owned presentation of an open document inside the content
pane, including its title bar, editor, and document panels. The shell places the
surface but does not render its internals.
_Avoid_: Document shell, Editor chrome

**Notification**:
A pointer at one Drive activity row addressed to one person. The rail's
Notifications bell shows these and nothing else; mail unread is a separate
count on the Mail area.
_Avoid_: Alert, Activity, Feed item

**Guest surface**:
The shell's presentation of a document or folder to a visitor without a
Suite session, whether access comes from a link credential or `$PUBLIC`. It
has no rail and no sidebar. The same pages render, with only the actions the
visitor's role allows.
_Avoid_: Public view, Link view, Shared view

**Platform**:
Product-neutral client capabilities every area uses: session, server state,
transport, realtime, theme, translation, page meta and common feedback
mechanics. Product-specific dialog meaning and content stay with their owner.
_Avoid_: Utils, Common, Shared, Boot

**Suite resource**:
Product-neutral account, site, user or invitation data owned by Suite and
consumed by the shell or products.
_Avoid_: Shell endpoint, Shared app data

**Flip** (historical):
The staged switch from the old pages to the new ones, keyed by
`suite_flip_shell` and `suite_flip_files` in the site config. Both keys and
the old pages are deleted (Faris, 2026-10-03): the shell and the new Drive
are always on, and rolling the migration back is a full backup restore. Old
URLs reach the new pages through the backend's redirect table and
`composition/redirects.ts`.
_Avoid_: Cutover, Launch, Migration

**Standalone chrome** (historical):
The sidebar header, tab bars and Apps, Settings and Log out entries Mail,
Calendar and Meet drew while their routes were outside the shell. Deleted
with the flips: each product renders its sidebar through the platform's
`<AreaSidebar>` and its header with frappe-ui's `PageHeader` and
`PageHeaderMobile`, and the shell's rail, bottom nav and account menu carry
the rest.
_Avoid_: Legacy header, Old menu, Fallback chrome

## Flagged Ambiguities

- **Workspace**: today's shell uses it for the site's organisation settings
  (`shell/useWorkspace.ts`, `WorkspaceSettings.vue`). The base prototype
  used it for a Drive Root. The prototype's switcher is removed; use
  "Drive Root", "Shared Root" or "Personal Root" for the Drive meaning.
- **App**: older docs use it for a product's code and route prefix. In the
  shell's language a product is an Area only if it has a rail item
  (`composition/appRegistry.ts` lists them). Writer, Sheets and Slides are
  products without an area.

## Shell mount seam

An in-shell route gets the rail and one box. `scroll: 'shell'` lets the
frappe-ui shell viewport scroll the whole page. `scroll: 'content'` gives the
page a fixed `h-full min-h-0 min-w-0 overflow-hidden` box so it owns
scrolling. A fixed-size canvas can mount inside it without growing any shell
ancestor. A page adds its own Area sidebar inside the box with the platform's
`<AreaSidebar>`. `frame: 'none'` puts the page outside the shell: the Meet
call and Mail's sign-in pages (unified frontend spec §14.2).
