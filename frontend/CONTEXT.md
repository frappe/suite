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

**Document**:
A content node (Writer, Sheets, Slides, or a previewable file) opened in the
content pane with the panel hidden and the shell owning the title bar.
_Avoid_: Editor page, File view

**Platform**:
Product-neutral client code every area uses: session, REST client, socket,
theme, translation, page meta.
_Avoid_: Utils, Common, Shared, Boot

## Flagged Ambiguities

- **Workspace**: today's shell uses it for the site's organisation settings
  (`shell/useWorkspace.ts`, `WorkspaceSettings.vue`). The base prototype
  used it for a Drive Root. The prototype's switcher is removed; use
  "Drive Root", "Shared Root" or "Personal Root" for the Drive meaning.
- **App**: `apps/registry.ts` and `SUITE_APPS` mean a product's code and
  route prefix. In the shell's language a product is an Area only if it has a
  rail item. Writer, Sheets, Slides and Meet are products without an area.
