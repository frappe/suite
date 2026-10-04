# Writer parity with the old Writer

Status: proposed

## Scope

Writer features that the old Writer (on `develop`) had and the Drive-backed Writer (on `forge/drive-layer`) lacks or does worse. Each gap says what a user could do before, what happens now, and what done looks like.

Terms such as Content Document, Version, Template and Export are defined in [`suite/drive/CONTEXT.md`](../../suite/drive/CONTEXT.md). Writer has no `CONTEXT.md` or ADRs of its own yet.

Old paths are on `develop`. `fe/` means `frontend/src/apps/`.

Things checked and found equal or better are not listed. These include DOCX and Markdown download, DOCX import, inline comments, presence, the table of contents and tabs, the editor toolbar, Cmd+S, Cmd+K, Cmd+P, the offline badge, the unsaved-changes guard, guest editing through share links, and the mobile layout.

## Priority

| # | Section | Why |
|---|---|---|
| 1 | Bugs that are broken today | Something visible does nothing or does the wrong thing |
| 2 | Document settings and print | Needed to format and print a document |
| 3 | Version history | The Versions panel is always empty |
| 4 | Templates | "New from template" stays empty |
| 5 | Document actions inside the editor | Users must leave the document for common actions |
| 6 | Export and word count | Fewer ways to get content out |
| 7 | Smaller items | Low impact |

## 1. Bugs that are broken today

### 1.1 The Settings button does nothing

- **Before:** the toolbar Settings button opened the document settings dialog.
- **Now:** the button sets `showSettings`, but nothing renders a dialog. Confirmed in the browser.
- **Done:** the Settings dialog works again. The user can set the font, size and spacing, the print header, footer and page numbers, Lock, and Wide (section 2).
- **Stopgap:** hiding the button is acceptable until then, but it does not close this gap.
- **Where it was:** `fe/writer/components/WriterSettings.vue`, `fe/writer/pages/Document.vue`
- **Where it goes:** `fe/writer/components/core-editor/menu-buttons.js` (`openSettings`), `fe/writer/surface/WriterSurface.vue`

### 1.2 Locked documents open as editable (done)

- **Before:** a locked document was read-only until the user unlocked it.
- **Now:** `settings.lock` is ignored, so a locked document opens as editable.
- **Done:** a locked document opens read-only. The user can unlock it for the current session. See also "Lock and Wide view" in section 2.
- **Where it was:** `fe/writer/pages/Document.vue` (lock buttons)
- **Done:** `WriterSurface.vue` treats a truthy `settings.lock` as read-only (`isLocked` in `writerDocument.ts`). Unlocking for a session waits for the Settings dialog and the View menu in section 2.
- **Where it goes:** `fe/writer/surface/WriterSurface.vue`

### 1.3 Mention suggestions are empty for most users (done)

- **Before:** typing `@` in the body or in a comment listed every user on the site.
- **Now:** the list comes from `GET /api/suite/users`, which answers only a System Manager. Everyone else gets no suggestions.
- **Done:** any user who can open the document gets suggestions. The list is not limited to System Managers.
- **Where it was:** `suite.drive.api.product.get_users` (`allUsers`)
- **Done:** `listUsers` in `fe/writer/drive.ts` reads every page of `GET /api/suite/people`, which any Suite user may call, and keeps the users.
- **Where it goes:** `fe/writer/drive.ts` (`listUsers`)

### 1.4 The title never takes the first line (done)

- **Before:** pressing Enter in the first block renamed an untitled document to that line.
- **Now:** `autorename` checks for "Untitled Document" (capital D). Drive names new documents "Untitled document" (lower-case d), so the check never matches.
- **Done:** pressing Enter in the first block of a new, untitled document renames it to the first line. The check uses the one default title that Drive sets.
- **Where it was:** `fe/writer/components/CoreEditor.vue` (`autorename`)
- **Done:** `autorename` calls `hasDefaultDocumentTitle` from `fe/drive/client/nodes.ts`, next to the default title it checks.
- **Where it goes:** same file. The default title is in `fe/drive/client/nodes.ts`.

## 2. Document settings and print

| Gap | Before | Now | Done |
|---|---|---|---|
| Document settings dialog | Font family, font size, line spacing, and paragraph spacing above and below could be set for the whole document. The palette had a "Document settings" command. | Missing. The toolbar font, size and spacing controls change the selection only. `WriterDocument.update_settings` has no caller. | The dialog sets these defaults for the document. The palette command is back. |
| Defaults for new documents | An "Everywhere" tab saved defaults to `Drive Settings.writer_settings`. They applied under each document's own settings. | Missing. `writer_settings` is still on the Drive settings route, but Writer reads only the document's own settings. | New documents start with the user's saved defaults. A document's own settings win. |
| Print header, footer and page numbers | Header and footer text (left and right), page numbers and separator lines could be set, and printing used them. | Missing. `printDoc` still reads these settings, but nobody can set them. | They can be set in the dialog and appear in the printout. |
| Lock | A document could be locked. It was read-only until unlocked, and a header button unlocked it temporarily. | Missing. See 1.2. | A View menu item locks and unlocks the document. |
| Wide view | A View menu item set a 100ch column. | A document that is already wide stays wide. Nobody can change it. | The View menu item is back. |

- **Where it was:** `fe/writer/components/WriterSettings.vue`, `fe/writer/components/Navbar.vue` (View submenu), `fe/writer/utils/index.js` (`printDoc`), `fe/writer/pages/Document.vue` (`globalSettings`, lock buttons)
- **Where it goes:** `fe/writer/surface/WriterSurface.vue` (`settings`), `fe/writer/components/CoreEditor.vue` (`gridStyle`)

## 3. Version history

The Versions panel says "No versions yet" on a document that has been edited. Backend support exists: `WriterDocument.take_version`, `POST nodes/{node}/versions` and `session.versions.restore` (`fe/drive/client/session.ts`). Writer calls none of them. Sheets already does this in `suite/sheets/versioning/save.py`.

| Gap | Before | Now | Done |
|---|---|---|---|
| Automatic versions | A version was taken on the first edit and then at an interval. | None are taken. `WriterSurface.vue` passes a `newVersion` that does nothing, and `save_doc` takes no version. | Editing a document records Versions without any action from the user. |
| Named versions | The Manual tab created a version with a name. | Missing. | A user can save a version with a name. |
| Preview, diff and restore | The panel had Automatic and Manual tabs, grouped by day. Selecting a version showed a diff against the one before it. Restore returned the document to it. | A flat list of label, actor and time. No preview, no diff, no restore. | The old panel behaviour is back: two tabs, grouped by day, diff preview, Restore. |

- **Where it was:** `fe/writer/components/VersionsSidebar.vue`, `fe/writer/components/NewVersionDialog.vue`, `fe/writer/components/CoreEditor.vue` (`autoversion`), `fe/writer/extensions/diff-tag.ts`, `suite/writer/doctype/writer_document/writer_document.py` (`new_version`)
- **Where it goes:** `fe/writer/surface/WriterSurface.vue`

## 4. Templates

| Gap | Before | Now | Done |
|---|---|---|---|
| Snippet templates | A Templates dialog searched for a template and inserted it at the cursor. A template could have a keyboard shortcut. | Missing. The `Writer Template` doctype is deleted. Drive's "New from template" copies a whole document, which is a different feature. | The dialog and shortcuts are back, on top of the new template model. Its design is open. |
| Making a template | A template was a `Writer Template` row made in Desk. | No screen marks a document as a template. Only the API can set `is_template`. "New from template" stays empty. | A user can mark a document as a template, and unmark it, from the document or from Drive. |

- **Where it was:** `fe/writer/components/TemplateDialog.vue`, `fe/writer/extensions/core-editor.js` (`addKeyboardShortcuts`), `writer_template.json` (`keymap`)
- **Where it goes:** the Drive picker is `fe/drive/files/features/TemplatePicker.vue`

## 5. Document actions inside the editor

- **Before:** the `...` menu held Share, Download, Copy link, Move, Rename, Show info, Favourite or Unfavourite, Delete and Clear cache. The header showed a star for a favourite and an icon for public, site-wide or shared.
- **Now:** Share and Rename are in the Drive header. Copy link, Move, Show info, Favourite and Delete exist only in the Drive listing. Clear cache is gone. The header shows only Trashed, View only and Offline badges.
- **Done:** every action above works from the open document. The header shows favourite and sharing state. Clear cache drops the local copy kept in the browser.
- **Where it was:** `fe/writer/components/Navbar.vue` (`fileActions`)
- **Where it goes:** `DriveDocumentHeader`

## 6. Export and word count

| Gap | Before | Now | Done |
|---|---|---|---|
| Print or PDF menu item | Export > PDF and Download both printed. | Only Cmd+P prints, and only the current tab. | A menu item prints. Whether it prints all tabs is open. |
| Export as folder | Saved the HTML and pictures as a zip. | Missing. The Markdown download now zips pictures, which covers part of this. | An "HTML (zip)" export is back. |
| Export to Blog | Published the body as a Blog Post when the blog app is installed. | Missing. `create_blog` is still in `docs.py` and has no caller. | The export is back, shown only when the blog app is installed. |
| Word count | Show Info listed words, characters and reading time. | Missing. `CharacterCount` is loaded but nothing shows it. | Words, characters and reading time are shown for the open document. |

- **Where it was:** `fe/writer/components/Navbar.vue`, `fe/writer/utils/index.js` (`downloadZippedHTML`), `fe/writer/utils/exports.js`, `suite/writer/api/docs.py` (`create_blog`), `fe/drive/ui/drive/components/InfoDialog.vue`
- **Where it goes:** print is in `fe/writer/components/CoreEditor.vue` (`onKeyDown('p')`)

## 7. Smaller items

| Gap | Before | Now | Done |
|---|---|---|---|
| Notice for old documents | A banner and a toast said a non-collaborative (`collab = 0`) document cannot be edited together. | `NonCollabEditor` opens it with no notice. | The notice is back. |
| Embedded view | In an iframe, Writer showed a slim read-only header with the title and "Edited ...". | No iframe code is left. | The slim view is back. Decide first whether anything still embeds Writer. |

- **Where it was:** `fe/writer/pages/Document.vue` (`inIframe`), `fe/writer/components/WriterLayout.vue`

## Changed on purpose

These differ from the old Writer by design. They are not gaps.

| Old | Now |
|---|---|
| `/writer` listed the user's documents, grouped by day, with a New button. | Drive Home, Recents and the type filter replace it. Old paths redirect (`frontend/src/composition/redirects.ts`). |
| A `text/markdown` file opened in Writer's rich editor (`fe/writer/components/MarkdownEditor.vue`). | Markdown files open in Drive's Markdown preview. |

## Search

Today, Drive search matches titles only. The old Writer could search document text (Cmd+Shift+K). That index was removed.

Faris wants content search to work across Writer, Sheets, Slides and every other app, not only Writer. This is not a Writer feature. It belongs in a cross-app Drive spec, which does not exist yet. It is not designed here.
