---
id: 021
title: Account menu, Files entry points and icons
label: wayfinder:grilling
status: closed
assignee: faris (fable, 2026-09-29)
blocked-by: []
---

## Question

Small surface decisions the spec cannot make from the tickets.

- **Upgrade plan.** Ticket 016 puts it in the avatar menu but leaves
  visibility for non-admins undecided.
- **Open Desk.** Ticket 016 shows it to system users. The session has only
  a `systemManager` capability. Add a `systemUser` capability, or show Open
  Desk to system managers only?
- **Folder upload and New from template.** Tickets 007 and 009 decide both
  flows. No ticket places their entry points in Files (New menu, drop, row
  menu).
- **Icon source.** The prototype and the current code use frappe-ui's
  lucide sprite. Faris's standing rule is the Figma set unless he says
  otherwise. The map deferred this to "the first styling ticket"; Stages 4,
  8, 9 and 10 style.

Raised by the spec and plan audits of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).

## Resolution

Resolved on 2026-09-29. A Fable subagent answered the reversible
questions. Faris answered the icon set.

In short: Upgrade plan and Open Desk both key on the existing `systemManager`
capability, so the session interface in spec §3.8 does not change. Folder
upload and New from template become two entries in the Files New menu, and a
dropped OS folder runs the folder upload flow. The icon set is Faris's call:
lucide is what frappe-ui, the prototype and the code use today, and
frappe-ui's icon-pack plugin makes a later swap to the Figma set a codemod.

### Decided (reversible)

1. **Upgrade plan visibility.** Show it to system managers only. A non-admin
   cannot change a site's plan, and T016 already gates Workspace on the same
   capability, so the menu reuses one flag and adds none [T016 decisions 2
   and 5; `platform/session/index.ts` `SessionCapabilities`].
2. **Upgrade plan target.** The item stays disabled with the tooltip "Not
   available yet" until the site resource carries an upgrade link (ask S5).
   No code has a target today: `shell/accountMenu.ts` ships it disabled, and
   the only Frappe Cloud links are legacy signup links
   (`apps/drive/legacy/components/Navbar.vue:23`,
   `apps/writer/components/Navbar.vue:64`). A feature that waits on an ask
   stays disabled with the reason in its tooltip [T015 ruling 8; T016 "as
   today"].
3. **Open Desk condition.** Show it to system managers only. No new
   `systemUser` capability. Suite creates every invited user as a System
   User (`suite/api/account.py:133`; `suite/utils/user.py` `assign_role`
   gives the role desk access on purpose), so "system users" would show Desk
   to nearly everyone. Only the legacy Drive self-signup makes Website Users
   (`suite/drive/api/product.py:72`). Desk is the admin console, and the
   people who get Workspace settings are the people who need it. The
   session shape in §3.8 stays as it is [T016 decision 5; spec §3.8; ticket
   021 question, second option].
4. **Session boot stops reading the `system_user` cookie.** Today
   `createSession` seeds `systemManager` from `cookies.system_user === 'yes'`
   and overwrites it from `roles.system_manager` after refresh
   (`platform/session/index.ts`). The cookie means "not a Website User"
   (`frappe/auth.py:203-208`), not System Manager, so a plain user sees
   Workspace and Open Desk until the refresh lands. Boot seeds
   `systemManager: false`; the account route is the only source. Stage 4
   owns the fix [spec §3.8; `suite/api/routes.py` `account_get`].
5. **Open Desk mechanics.** A plain `<a href="/app">` menu item, full page
   load, same tab, placed after Settings and before Upgrade plan. Deleting
   `DESK_APP_SWITCHER_ITEM` from `apps/registry.ts` stays a Stage 4 task
   [T016 decision 5; plan Stage 4].
6. **Folder upload entry.** New gets **Upload folder** directly after Upload
   files. The list is Folder, Upload files, Upload folder, Document,
   Spreadsheet, Presentation, Link, From template. The legacy Navbar offered
   Upload File and Upload Folder as a pair
   (`apps/drive/legacy/components/Navbar.vue:377-385`), and users know the
   pair. The entry uses a hidden `<input type="file" webkitdirectory>`, as
   `legacy/components/FileUploader.vue:266` does today. It hides on the
   phone layout, where the OS pickers offer no folders [T006 New list; T007
   folder upload].
7. **A dropped folder is a folder upload.** When a drop carries a directory
   (`DataTransferItem.webkitGetAsEntry().isDirectory`), the queue runs the
   T007 folder flow into the drop target: top folder collision only, Keep
   both or Skip. Same UPLOAD rule and same overlay as a file drop. There is
   no separate drop surface [T007 drop targets and folder upload].
8. **New from template entry.** New gets **From template** as its last
   entry, after Link. It opens one Drive-owned template picker dialog under
   `apps/drive/files/features/`. The picker has one TabButtons per
   registered document type (label from `newLabel()`, filter from
   `contentDoctype`, both read through `DOCUMENT_TYPES_KEY`), lists
   `GET /views/templates?content_doctype=` as tiles with the preview
   expansion, and has a Name field. Create calls `POST /nodes/<template>/copy`
   with the open folder as `parent` and the name as `title`, then opens the
   returned node's `/d/` route. Copy keeps the server's title on conflict
   (T006). One entry with type tabs beats one submenu per document type:
   the picker needs the type filter either way, and the menu stays flat.
   No row-menu entry: templates never appear in ordinary listings (Drive
   §8.10). No Home entry: T012 fixed Home's New to three kinds [T009; Drive
   §8.9 and §8.10; `suite/drive/http/routes.py` `node_copy` and
   `_view_filters`; `apps/drive/client/views.ts` already types
   `'templates'`].
9. **Template and folder entries through a link.** From template creates a
   document, so below EDIT through a link it hides with Document,
   Spreadsheet and Presentation (§10.14). Upload folder follows Upload
   files. The empty state's New offer is unchanged [T011; T006].
10. **Making a template is not a launch surface.** No "Use as template" row
    action and no Templates saved view. T006 fixed the row menu and the saved
    views, and shipped templates live in Administrator's Templates folder
    (Drive §8.10). Recorded as a post-launch item, not an open item [T006;
    Drive §8.10].
11. **Icon names stay in two lookups.** `apps/drive/files/internal/icons.ts`
    is the only MIME-family and content-kind lookup, and each product's
    `DocumentTypeDefinition.icon` is the only product mark. Every other icon
    is a literal `icon` string or `<span class>` per frappe-ui's contract.
    Whatever set Faris picks, a swap touches these lookups and the literal
    names, never markup shape [T006; T009; frappe-ui skill contract 4].

### Faris's answer

1. **Icon set: lucide.** Faris, 2026-09-29: "lucide". The unified
   frontend uses frappe-ui's lucide icons on every surface. This overrides
   the standing Figma rule for this effort. No Figma swap is planned;
   decision 11 (icon names in one place) stays because it costs nothing.

The question as it was put:

1. **Icon set for the unified frontend.** Every icon in the shell, Files,
   Home and the document title bars is a lucide glyph today, drawn through
   frappe-ui's `lucide-<name>` class: 540 uses of 178 names across
   `frontend/src`, 61 names on the new shell, composition, Files and Home
   surfaces. The base prototype uses the same classes. frappe-ui ships only
   lucide (`lucide-static` through `tailwind/lucideIconsPlugin.js`, stroke
   1.5) and draws its own chrome with it: a Dialog's close X, a Combobox
   chevron, an Alert's status icon. No Figma icon export exists in this repo
   or in frappe-ui; `espresso-v2-design-tokens` holds colour, text and
   effect tokens only. The prototype traced one Figma icon by hand
   (`StarMark.vue`, `icon/solid/star`), so a set exists in Figma. Its
   coverage of MIME-family, action and product icons is not verified.
   Example: the Files row for `report.pdf` shows `lucide-file` tinted
   `text-ink-red-6`; the Rename dialog beside it shows frappe-ui's own lucide
   X. With a Figma set the row icon changes and the X does not.
   Options:
   - A. Lucide for everything. Pro: no cost, matches frappe-ui's internals
     and the prototype, no stage waits. Con: breaks the standing rule; Suite
     looks like every other frappe-ui app.
   - B. Figma set on Suite-owned surfaces (shell, Files, Home, document
     title bars); lucide stays inside frappe-ui chrome and in Mail, Meet and
     Calendar until they migrate. Pro: follows the rule; frappe-ui's
     `tailwind/iconPackPlugin.js` registers any flat SVG folder as
     `<prefix>-<name>` classes, so the change is one Tailwind plugin line
     plus a rename codemod. Con: needs a Figma export with a naming
     convention and an owner; two sets sit side by side in one dialog;
     stages 4, 8, 9 and 10 wait on the export and on filling gaps such as
     `folder-input` and `list-checks`.
   - C. Lucide now, B later. Pro: no wait, and B's cost does not grow,
     because the class mechanism is the same. Con: a second visual pass over
     every page after launch.
   Recommendation: C. frappe-ui itself cannot leave lucide, so a Figma set
   never covers the whole screen. Ship on lucide, and swap Suite-owned
   surfaces when an export exists. Decision 11 keeps that swap a codemod.
   **Question:** Ship the unified frontend on lucide and treat the Figma set
   as a later swap (C), or export the Figma set first and block stage 4 on
   it (B)?

### Spec and plan changes

`unified-frontend-spec.md`:

- §3.8 Session: add "Boot seeds `systemManager` false. The account route is
  the only source; the `system_user` cookie is not read [T021]." The
  interface block does not change.
- §3.16: replace the last bullet's pointer to this ticket with Faris's icon
  answer. Add "Icon names live in `apps/drive/files/internal/icons.ts` and in
  each `DocumentTypeDefinition.icon`; other icons are literal names [T021]."
  Under C, add "Suite-owned surfaces swap to the Figma set through
  `iconPackPlugin` after launch [T021]."
- §5.12 New menu: the first bullet lists Folder, Upload files, Upload folder,
  one entry per document type, Link, From template. Add "Upload folder hides
  on phone [T021]." Add "From template opens the Drive-owned template picker:
  type tabs from the document registry, `GET /views/templates?content_doctype=`,
  a Name field, `POST /nodes/<template>/copy` with `parent` and `title`, then
  the `/d/` route [T021, T009, Drive §8.10]."
- §6.6 Folder upload: add "Entry points: Upload folder in New, and a dropped
  directory on any drop target (§6.7) [T021]."
- §6.7 Drop targets: add "A dropped directory runs the folder flow (§6.6)
  into the target [T021]."
- §8.9 Creation: add "Files hosts the template picker (§5.12) [T021]."
- §10.14: the hidden entries are Document, Spreadsheet, Presentation and
  From template.
- §12.6: the desktop row becomes "Name and email header, Settings, Open Desk
  (system managers), Upgrade plan (system managers; disabled until ask S5),
  Log out". Add "Open Desk is an `<a href="/app">` full page load [T021]."
  Remove the last bullet's pointer to this ticket.
- §15.2 Suite asks: add S5 "Site resource carries `upgrade_url`, null when
  the site has no plan page" (raised by T021, depends 12.6, open).
- §16.1: remove items 6, 7, 8 and 9. If Faris picks C, add a post-launch
  item under §16.2: "Swap Suite-owned surfaces to the Figma icon set."
- §16.3: add "Making a document a template from the client (`is_template`
  on a user's node) has no entry point at launch; Drive §8.10 ships
  templates from Administrator's Templates folder [T021]."

`unified-frontend-plan.md`:

- Stage 4 Files: add `platform/session/index.ts` (boot seed). Work: the
  avatar menu bullet becomes "header, Settings, Open Desk (system managers,
  `<a href="/app">`), Upgrade plan (system managers, disabled until S5), Log
  out"; add "Session boot stops reading the `system_user` cookie." Depends
  on: replace "Upgrade plan, Open Desk and icons wait on ticket 021" with
  the icon answer only, or drop it once answered.
- Stages 8 and 9 Depends on: drop "Icons wait on ticket 021" once answered.
- Stage 10 Work: add "Upload folder in New, hidden on phone; a dropped
  directory runs the folder flow." Depends on: drop the ticket 021 clause.
  Exit gate: the folder upload journey starts from New and from a drop.
- Stage 11 Files: add `apps/drive/files/features/` (template picker) and
  `FilesPage.vue` (From template entry). Work: "New from template: the Files
  picker over `views/templates` and `copy`, then `/d/`." Depends on: drop the
  ticket 021 clause. Exit gate: add "a journey creates a document from a
  template and lands on its `/d/` route."
- Open items, "Owned by open tickets": remove the ticket 021 entry, or reduce
  it to the icon answer while it is pending.
- Backend asks by stage, Suite table: add S5, source 021, stage waiting
  "none: the item stays disabled", not shipped.

### Asks

- S5 (Suite): `GET /api/suite/site` carries `upgrade_url`, null when the
  site has no plan page, so Upgrade plan has a target. Blocks nothing; the
  menu item stays disabled until it ships.
