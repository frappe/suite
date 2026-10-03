# Drive demo user testing, 2 October 2026

## Scope

I tested the signed-in Drive demo at `http://drive-layer.localhost:8084/drive` in Chrome. The main path was the `Frappe UI · IndiaFOSS 2026` folder, its files, and the nearby Drive views. I used the normal desktop viewport and 390 px and 320 px wide viewports. The app uses Vue, Frappe UI components, and Frappe UI design tokens. I read `apps/suite/AGENTS.md` and `apps/suite/frontend/AGENTS.md` before the review.

This was a user test and source inspection. I made no code or sharing changes. I did not test another account, an actual screen reader, dark mode, 200% browser zoom, or offline behavior.

| Area | What I checked | Result |
| --- | --- | --- |
| Accessibility | Keyboard opening in list view, accessibility tree for Drive, Sheets toolbar, and dialogs | One high finding and one form finding |
| Layout | Desktop, 390 px, and 320 px Drive screens; mobile share dialog | One mobile finding |
| Writing | Search empty state, file preview messages, create dialog | One copy finding |
| Typography | Visible names, labels, and wrapping in the tested screens | No other actionable finding |
| Color | Light theme states in the tested screens | No obvious issue; contrast was not measured |
| UI polish | Grid and list views, preview, search, folder titles, and file actions | Three findings |

## Findings

| Priority | Area | Location | Reproduction and observed result | Suggested fix |
| --- | --- | --- | --- | --- |
| **High** | UI | `frontend/vite.config.ts:134`, `frontend/src/apps/drive/files/features/preview/FilePreviewSurface.vue:62` | Open `Chart labels — after.webp` through port 8084. Both its grid thumbnail and full viewer show broken images. The content API redirects to `/f/<id>/...`; Vite does not proxy `/f/`, so the redirect returns SPA HTML. The same content URL returns valid WebP through Bench on port 8004. | Proxy the signed `/f/` route to Frappe in development. Verify a redirected image in both grid and full preview. |
| **High** | Accessibility | `frontend/src/apps/sheets/components/SheetEditor/index.vue:246-315` | Open `Component review (editable)`. The accessibility tree contains many unnamed formatting buttons and pop-up buttons, including Bold, Italic, alignment, color, Undo, and filter controls. Their `tooltip` props do not give the controls accessible names. | Add accessible names to each icon-only control, including the native color buttons. Keep the tooltip for pointer users. |
| **Medium** | UX | `frontend/src/apps/drive/files/pages/FilesPage.vue:300`, `frontend/src/apps/drive/files/features/FilesListing.vue:97-105` | Search for `chart` while inside `Talk`. The results come from sibling folder `UI examples`, but the breadcrumb still says `Talk`. Grid cards do not show each result's folder. A reader can mistake the results for files in `Talk`. | Mark the view as a Drive-wide search and show each result's location in grid view. Keep the folder breadcrumb only when search is scoped to that folder. |
| **Medium** | Accessibility | `frontend/src/apps/drive/files/pages/FilesPage.vue:618-625`, `frontend/src/platform/feedback/index.ts:66-74` | Choose New → Folder and press Create with an empty Name. The dialog stays open, focus stays on Create, and no visible error appears. The input is invalid under native validation. | Show an inline required-field error and focus Name after the failed submission. |
| **Medium** | Layout | `frontend/src/apps/drive/files/features/share/ShareBody.vue:48-49` | At 320 px, open Share for `Component review (editable)`. The general-access explanation is cut to `Only people added can op...`. This is information about who can open the file. | Let the access explanation wrap on small screens, while keeping the access control visible. |
| **Low** | Writing | `frontend/src/apps/drive/files/pages/FilesPage.vue:331-332` | Search for a term with no matches. The title says `No files match this search`, but the next line says `Files will appear here when available.` It suggests waiting instead of changing the query. | Use search-specific help such as `Try a different search term.` |
| **Low** | UI polish | `frontend/src/apps/drive/files/pages/routes.ts:12` | Every open folder sets the browser tab title to `Folder`, even after the folder name loads. Multiple folder tabs cannot be identified by title. | Set the page title to the loaded folder name. |

## Design review, second pass

A second pass looked for UI inconsistencies and polish gaps, the way a senior designer would. It used the same site and account at 1440 px and 390 px. It covered list and grid views, every sidebar view, search, selection mode, menus, the Share and New folder dialogs, Settings, Statistics, the file preview, and the Slides, Sheets, and Writer editors. These findings are new; none repeats the table above. I made no code changes. Dark mode, screen readers, and 200% zoom remain untested; Administrator's theme is set to light, so changing the OS setting has no effect.

### High

| Area | Location | Reproduction and observed result | Suggested fix |
| --- | --- | --- | --- |
| Layout | `frontend/src/apps/drive/files/features/FilesListing.vue` | At 390 px, switch to list view. The Name column shrinks to 0 px and the page scrolls sideways (416 px of content in a 390 px viewport). Owner text overlaps the file icons, and the sort arrow overlaps the `Owner` heading. The first pass only checked grid view at this width. | Hide Owner and Modified on small screens and give Name the remaining width. |
| UI | `frontend/src/apps/slides/components/OverflowContentOverlay.vue` | Open any presentation. The overlay dims everything outside the slide with a `0 0 0 200vmax` shadow. Nothing confines that shadow to the canvas, so it covers the header, the Share button, and the properties panel with 60% gray. The editor looks disabled. | Clip the overlay to the canvas viewport, or draw the mask inside the canvas only. |
| Layout | `frontend/src/apps/slides/surface/SlidesSurface.vue` | At 390 px, open the presentation. The canvas is not visible, the slide thumbnails are clipped, the properties panel fills the screen, and the title is cut to `Frappe U`. | Choose a phone layout: view-only, or canvas first with panels opened on demand. |
| UX | `frontend/src/apps/drive/files/features/share/ShareBody.vue:30`, `:126`, `:218` | Open Share on a file you own. The owner appears only in a collapsed section labeled `From "Administrator" · 1`, with the role `Manage` and a `Deny access here` button. The People section says `No one is added here yet.` | Show the owner first in People, labeled Owner, with no deny action. |
| Accessibility | `frontend/src/apps/drive/files/features/FilesListing.vue` | In list view, select every row one by one. The header checkbox stays unchecked and reports `aria-checked=false`. Row checkboxes have no accessible names. | Derive the header state (checked or mixed) from the selection. Name each row checkbox after its file. |

### Medium

| Area | Location | Reproduction and observed result | Suggested fix |
| --- | --- | --- | --- |
| UX | `frontend/src/apps/drive/files/pages/FilesPage.vue:264` | Open any folder under My files. The home folder is called `Administrator` in breadcrumbs, search result paths, and the Share dialog. Inside a subfolder, `My files` in the sidebar loses its highlight. The highlight is faint at `/drive/f/cdd7e8607b/administrator` and strong at `/drive`. | Show the home folder as `My files` everywhere. Highlight the sidebar item for the breadcrumb root. |
| UI | `frontend/src/apps/drive/files/features/FilesListing.vue:97`, `:257-264` | View a folder with a failing thumbnail in grid view. The card shows the browser's broken-image icon, with the `…` button on top of it. The error handler retries once before falling back. If the retry uses the same URL, the browser does not fire the error event again, so the fallback likely never runs. This cause is unconfirmed. | Fall back to the file-type icon after the retry fails, or change the URL on retry. |
| UI | `frontend/src/apps/drive/files/features/FilesListing.vue:97-105` | Open the demo folder in grid view. Cards with thumbnails are taller than cards without, so names do not line up across a row and rows differ in height. | Give every card the same preview area, with the type icon centered when there is no thumbnail. |
| UX | View settings menu | In grid view, try to sort. Sorting exists only in list column headers, and View settings has no sort option. | Add a sort option to View settings. |
| Writing | `frontend/src/apps/drive/files/features/FilesListing.vue:204` | Search for `chart`. Result paths join folder names with `›`; breadcrumbs use `/`. | Use one separator. |
| UX | `frontend/src/apps/drive/files/pages/FilesPage.vue:551-553` | Open a row's `…` menu. It is a flat list of 10 items. `Move to trash` sits between Share and Select instead of last, Share is the 8th item, and there is no Copy link. View settings, by contrast, uses section headings. | Group the items (open and share, organize, select) and put the destructive action last. Add Copy link. |
| UI | `frontend/src/apps/drive/files/pages/FilesPage.vue:551` | Compare Share in the row menu and in editor headers. The row menu uses `lucide-user-plus`; headers use `lucide-share-2`. | Use one Share icon. |
| Accessibility | View settings menu | Open View settings. The selected view and group-by look like hover states, with no check mark, and use `menuitem` instead of `menuitemradio`. The column switches have no accessible names. View items have icons; Group by items do not. | Use radio items with check marks, name the switches, and treat icons the same in both groups. |
| Writing | `frontend/src/apps/drive/files/pages/FilesPage.vue:429` | Open More file actions. It offers only `Select rows` and `Select all loaded`. `Loaded` exposes pagination to the user, and there are no folder actions. | Rename to `Select all`. Consider adding folder actions such as Share and Rename. |
| UI | `frontend/src/apps/drive/files/pages/FilesPage.vue:45` | Enter selection mode. `Done` is solid black and outweighs Move and Move to trash. Selected rows are not highlighted. The Name column shifts 32 px to the right. | Make Done a quieter button, highlight selected rows, and keep the Name column in place. |
| UI | `frontend/src/apps/drive/files/features/FilesListing.vue` | Double-click a row to open it. The row's text is selected, and the highlight is still visible when you come back. | Add `select-none` to rows. |
| Writing | `frontend/src/apps/drive/files/pages/FilesPage.vue:331-332` | Open Shared with me, Trash, and Organization files with no items. All use one template: `<View> is empty` and `Files will appear here when available.` Trash reads oddly and does not say how long items are kept. Organization files says `Create a folder or document to get started.` but has no button. Search, view, and select controls stay visible. | Write copy and actions for each view. Hide controls that do nothing on an empty view. |
| UX | Recent view | Open Recent. It lists folders, shows the modified date instead of the last-opened date, uses absolute dates even for today, and has no time grouping. | List files only, by last opened, with relative dates and Today/Earlier groups. |
| UI | Search field | Type a query. Chrome's built-in blue clear button appears, which does not match the palette. Starting a search also resets the sort to Modified and hides the New button. | Hide the native clear button and use a styled one. Keep the user's sort. |
| Layout | Grid view at 390 px | Open the demo folder on a phone. Grid view shows one column of large cards, so about 4 items fit on screen. | Use two columns on phones. |
| UI | Grid card names, phone title | Look at a long file name in grid view or the page title at 390 px. Names are cut off with no tooltip, and the phone title is cut without an ellipsis. | Add a tooltip or `title` and truncate with an ellipsis. |
| UX | Statistics | Open Statistics. It lists files that do not appear in Drive, such as screen recordings and mp4 files with hash-like names. It counts `Talk notes.md` as Application. File-type icons are gray while the largest-files icons are colored. | Count only files the user can see in Drive, or explain the difference. Use one icon style. |
| Layout | `frontend/src/apps/drive/files/features/share/ShareDialog.vue:14` | Open Share at desktop size. The body has a fixed `h-96`, so it scrolls by 19 px. The scrollbar overlaps the `Off` selects, and text is cut mid-line. | Let the body size to its content, with a maximum height. |
| Accessibility | `frontend/src/apps/drive/files/features/share/ShareDialog.vue`, `ShareBody.vue` | Open Share. Focus starts on Close instead of the people field. Two different buttons are both named `Off`. | Focus the people field on open. Give each access control a distinct name. |
| Writing | `frontend/src/apps/drive/files/features/share/ShareBody.vue:175`, `:211`; `ShareDialog.vue:47` | Open Share. `Notify by email` shows before anyone is added. `Everyone at the org` is vague. The off text differs between rows (`Only people with access can open it` and `Only people added can open it`). The title uses straight quotes. There is no Copy link or Done button. | Show Notify only after someone is added. Name the organization. Use one off text and curly quotes. Add Copy link and Done. |
| Accessibility | `frontend/src/apps/drive/files/pages/FilesPage.vue:618-625` | Choose New → Folder. Focus lands on Close, which shows a focus ring, instead of Name. There is no default name. | Focus Name on open and suggest `Untitled folder`. |
| UI | `frontend/src/apps/sheets/surface/SheetsSurface.vue:180-230`, `frontend/src/apps/slides/surface/SlidesSurface.vue:428`, `frontend/src/apps/writer/surface/WriterSurface.vue:274-276`, `frontend/src/apps/drive/files/features/preview/FilePreviewSurface.vue:54` | Open a sheet, a presentation, a document, and an image. Share is a ghost button in Sheets and solid in the other three. Each header uses a different leading icon, title weight, and set of actions: Slides has Export, Sheets has a File menu, and the preview has Upload new version and Download. Sheets shows no saved status. | Share one editor header across apps, with fixed slots for title, status, Share, and app actions. |
| Accessibility | `frontend/src/apps/sheets/components/SheetEditor/index.vue:120-175`, `frontend/src/apps/writer/surface/WriterSurface.vue:274` | Open a sheet. Notes (`lucide-message-square`, tooltip only, no accessible name) sits next to Comments (`lucide-messages-square`); the two speech-bubble icons are hard to tell apart. Writer uses Sheets' Notes icon for its Comments button. | Use one Comments icon in all editors and a different icon for Notes. Name every icon-only button. |
| UX | `frontend/src/apps/drive/files/features/preview/FilePreviewSurface.vue` | Open an image from Drive. The preview has no breadcrumb or way back to its folder, no Drive sidebar, no `…` menu (Rename, Star, Move), no file details, and no previous or next. The header shows a generic file icon instead of the image icon. | Add a breadcrumb back to the folder, the file menu, details, and previous/next. Use the file-type icon. |

### Low

| Area | Location | Reproduction and observed result | Suggested fix |
| --- | --- | --- | --- |
| UI | New menu | Open New. It is a flat list of 8 items that mixes create and upload actions. Its icons are gray while the list uses colored type icons. The button's up/down chevron reads as a select field, not a menu. | Group create and upload actions, use the type icons, and use a down chevron. |
| UI | Drive chrome | In My files, every row's Owner says `Administrator`. Settings appears in both the sidebar rail and the Account menu. `Upgrade plan` shows as a disabled item. | Hide Owner in My files, keep one Settings entry, and hide unavailable items. |
| UI | Settings dialog | Open Settings. It has no close button. `Update Password` is in Title Case. Its inputs use the outline style while other inputs use the filled style. | Add a close button, use sentence case, and use the standard input style. |
| Writing | Writer and Slides toolbars | Writer labels are Title Case (`Font Color`, `Bullet List`, `Page Break`, `Paint Styles`), and Slides has `Add Slide`. Other labels use sentence case. Slides shows two identical `Apply to all slides` buttons. | Use sentence case everywhere and make the duplicate buttons distinct. |
| Writing | Writer | Open a document alone. The header says `1 present`. The placeholder `Start thinking...` uses three periods instead of an ellipsis. The outline toggle has no accessible name, and the font-size field reports `aria-valuemax=0`. | Hide presence when alone, use `…`, name the toggle, and set a real maximum. |
| UI | Sheets at 390 px | Open the sheet on a phone. The font-size box is blank, and the tab title briefly reads `Document`. | Show the current size and set the title from the file name at once. |
| UI | Slides cold load | Open the presentation with a cold cache. The page is blank white for about 6.5 s with no loading placeholder. This was measured on the Vite dev server, which may account for part of the delay. | Show a loading placeholder for the editor. |
| UI | Drive sidebar | Look at the sidebar. Only Trash has a divider above it, and section labels are the same size as body text. | Use consistent dividers and a smaller label style. |

## Demo data issue

`Talk notes.md` opens to `No preview`. Its Drive node `7aj830s4po` stores MIME type `application/octet-stream`, although its content endpoint returns 729 bytes of `text/markdown`. The preview accepts `text/*` but excludes the stored MIME type (`frontend/src/apps/drive/files/features/preview/FilePreviewSurface.vue:28-37`). Repair the demo upload metadata or replace the note with a native document. This affects this seeded item; it does not show that all Markdown previews fail.

`Component review.xlsx` also shows `No preview`. The current preview code does not list XLSX as a supported type, and the adjacent native sheet opens correctly. I did not count that as a bug.

The second pass found more demo data to clean up. Items named `asdfasdf`, `Untitled`, and `(demo copy)` appear next to the curated files, and the `Untitled` presentation has a broken thumbnail. `Frappe UI IndiaFOSS 2026 (demo copy)` does not match its folder name, which uses `·`. The sheet's header row is not bold.

## Checks that passed

- Opened the demo folder and its `Planning`, `Talk`, and `UI examples` subfolders.
- Opened the 89-slide presentation and the editable sheet. The sheet showed the imported component rows.
- Switched from grid to list view. Tab reached a file row, and Enter opened the sheet.
- Opened and dismissed the Share dialog with Escape.
- Opened Starred and Recent. The seeded favorite and recently opened files appeared.
- Checked Drive grid view at 390 px and 320 px. The listing and primary controls stayed visible. List view at 390 px does not; see the second pass.

**Verdict: Block for the tested demo.** Fix the signed-file proxy and the unnamed sheet controls before using this as a polished demo. The second pass adds three fixes that are visible in the first minute of a demo: the faded Slides editor, list view on a phone, and the owner shown as removable in the Share dialog. Many of the remaining findings come from the same cause: each surface sets its own header, menu, and empty-state rules. A shared editor header and shared menu and empty-state conventions would resolve most of them together.
