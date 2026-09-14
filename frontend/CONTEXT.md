# Suite shell

The Suite shell is the frame every product renders inside: one rail, one
contextual panel, one content pane. It is being charted at
[`wayfinder/unified-frontend/MAP.md`](../wayfinder/unified-frontend/MAP.md).
Layout authority is the base prototype named there. Module boundaries follow
[`ARCHITECTURE.md`](../ARCHITECTURE.md) rule 8.

## Language

**Shell**:
The frame around every area: rail, contextual panel, content pane, and on
mobile the bottom nav and bottom sheet.
_Avoid_: Layout, App container, Launcher

**Rail**:
The thin always-visible column of area icons plus Search, Notifications,
Settings and the account.
_Avoid_: Sidebar, Nav bar, App switcher

**Area**:
One rail destination with its own routes, panel body and content. Home,
Files, Mail and Calendar are areas. An open document is not an area; it is
where the shell puts a document.
_Avoid_: App, Product, Module (those name code ownership, not navigation)

**Contextual panel**:
The column beside the rail whose content follows the active area. Hidden
while a document is open. On mobile it is the bottom sheet.
_Avoid_: Sidebar, Drawer, Left nav

**Content pane**:
The main region an area or an open document renders into. Home and Files
scroll it as a page; Mail, Calendar and an open document manage their own
scrolling.
_Avoid_: Main, Page, Viewport

**Files**:
The area that shows the Drive tree. Files is the area name; Drive is the
product that owns it.
_Avoid_: Drive (as an area name), My Drive, Home folder

**Drive Root**:
A top-level Drive namespace. A root is either Personal or Shared and is a
location, not a saved view.
_Avoid_: Workspace, Drive space

**Personal Root**:
The Drive Root owned by one user, presented in Files as **My files**.
_Avoid_: Home, Home folder, Personal workspace

**Shared Root**:
The business site's organization-owned Drive Root, presented in Files as
**Organization files**. Personal sites do not have one.
_Avoid_: Everyone, Shared drive, Organization workspace

**Saved view**:
A computed Files listing such as Shared with me, Recent, Starred, or Trash. It
does not own nodes and is not a Drive Root or folder.
_Avoid_: Smart folder, Root

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
The shell-less presentation of a document or folder to a visitor without a
Suite session, whether access comes from a link credential or `$PUBLIC`.
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

## Flagged Ambiguities

- **Workspace**: today's shell uses it for the site's organisation settings
  (`shell/useWorkspace.ts`, `WorkspaceSettings.vue`). The base prototype
  used it for a Drive Root. The prototype's switcher is removed; use
  "Drive Root", "Shared Root" or "Personal Root" for the Drive meaning.
- **App**: `apps/registry.ts` and `SUITE_APPS` mean a product's code and
  route prefix. In the shell's language a product is an Area only if it has a
  rail item. Writer, Sheets, Slides and Meet are products without an area.
