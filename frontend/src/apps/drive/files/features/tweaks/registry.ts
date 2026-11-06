/** The panel's sections, in order. */
export const tweakGroups = [
  'Bugs',
  'Merge similar concepts',
  'Fewer steps',
  'Habits',
  'Performance',
  'Slow operations',
] as const

export type TweakGroup = (typeof tweakGroups)[number]

export interface Tweak {
  id: string
  /** The item number in the Drive UI/UX list. */
  item: number
  group: TweakGroup
  label: string
  /** One sentence: what changes when the tweak is on. */
  description: string
  /** False until the change is built: the panel shows its switch disabled. */
  ready: boolean
}

/** Every Drive tweak, one per line. Split an item into sub-ids such as `t3-folder-menu`. */
// prettier-ignore
export const tweaks = [
  { id: 't1', item: 1, group: 'Bugs', label: 'Accurate "Change your own access?" warning', description: 'The warning says what you can still do after the change, such as "You will only be able to view this item".', ready: true },
  { id: 't2', item: 2, group: 'Bugs', label: 'Page stays still behind the share dialog', description: 'Changing access no longer redraws the sidebar, breadcrumb and listing behind the share dialog.', ready: true },
  { id: 't3-folder-menu', item: 3, group: 'Merge similar concepts', label: 'Folder menu has the row actions', description: 'The open folder\'s "…" menu offers the same actions as its row menu, and Move to trash goes up to the parent folder.', ready: true },
  { id: 't3-selection-menu', item: 3, group: 'Merge similar concepts', label: 'Selection bar with "…"', description: 'The selection bar shows the count first, and one selected item gets a "…" button with its row menu.', ready: true },
  { id: 't4-type-names', item: 4, group: 'Merge similar concepts', label: 'Document types named as in New', description: 'The Type column says "Document", "Spreadsheet", "Presentation" or "Drawing", as the New menu does.', ready: true },
  { id: 't4-location', item: 4, group: 'Merge similar concepts', label: 'Details names the root as the sidebar does', description: 'The Location in Details starts with "My files" or "Organization files", not the root\'s stored title.', ready: true },
  { id: 't4-storage-tab', item: 4, group: 'Merge similar concepts', label: 'Settings tab named "Storage"', description: 'The Drive settings tab and its heading say "Storage" instead of "Statistics".', ready: true },
  { id: 't4-access-words', item: 4, group: 'Merge similar concepts', label: 'One name for org and public access', description: 'The share dialog, Details and the move warning say "Public on the web" and "Everyone at {workspace}", and the two rows say what the access allows.', ready: true },
  { id: 't4-public-off', item: 4, group: 'Merge similar concepts', label: 'Public switch removes, never denies', description: 'Switching public access off removes the grant here; an item public through its folder offers "Block public access here" instead of the switch.', ready: true },
  { id: 't5', item: 5, group: 'Merge similar concepts', label: 'One way to change a role', description: 'Every role menu in the share dialog, the people picker included, lists the roles first with a check, then expiry, then Remove.', ready: true },
  { id: 't6', item: 6, group: 'Merge similar concepts', label: 'One byte format', description: 'Every size in Drive counts in 1024s, as upload limits do, without a trailing ".0" and with your decimal separator.', ready: true },
  { id: 't7', item: 7, group: 'Merge similar concepts', label: 'One "Folder" in the New menu', description: 'The New menu\'s upload items say "Upload files" and "Upload folder", so only Create has "Folder".', ready: true },
  { id: 't8', item: 8, group: 'Fewer steps', label: 'New document opens at once', description: 'A new document, spreadsheet, presentation or drawing opens with the default title instead of asking for a name.', ready: true },
  { id: 't10', item: 10, group: 'Fewer steps', label: 'Desktop share footer', description: 'The desktop share dialog footer has a captioned Copy link and a Done button, like the phone layout.', ready: true },
  { id: 't11', item: 11, group: 'Fewer steps', label: 'Simpler duplicate-name dialog', description: 'The duplicate-name dialog has one Skip, shows the New name field only for Rename, and names its button after the choice.', ready: true },
  { id: 't12', item: 12, group: 'Fewer steps', label: 'Empty states with actions', description: 'Each empty view has its sidebar icon, an empty folder offers an "Upload files" button, and an empty search offers "Clear search".', ready: true },
  { id: 't13-arrow-keys', item: 13, group: 'Habits', label: 'Arrow keys move in the list', description: 'The list and the grid are one Tab stop, the arrow keys, Home and End move focus, Shift with them selects a range, and Space selects a card.', ready: true },
  { id: 't13-type-ahead', item: 13, group: 'Habits', label: 'Type to jump', description: 'Typing the start of a name moves focus to the next item with that name.', ready: true },
  { id: 't14-delete-key', item: 14, group: 'Habits', label: 'Delete key moves to Trash', description: 'Delete, like Mod+Backspace, moves the items to Trash, and in Trash deletes them forever after asking.', ready: true },
  { id: 't14-rename-key', item: 14, group: 'Habits', label: 'F2 renames', description: 'F2 opens Rename for the one item it acts on.', ready: true },
  { id: 't14-parent-key', item: 14, group: 'Habits', label: 'Alt+Up opens the parent folder', description: 'Alt+Up, or Cmd+Up on a Mac, opens the folder above and focuses the folder you came from.', ready: true },
  { id: 't14-undo-key', item: 14, group: 'Habits', label: 'Mod+Z undoes', description: 'Mod+Z runs the Undo of the newest change toast still on screen.', ready: true },
  { id: 't14-focused-row', item: 14, group: 'Habits', label: 'Keys act on the focused row', description: 'With nothing selected, Delete, F2, Share and Open in new tab act on the row that shows keyboard focus.', ready: true },
  { id: 't15-escape-closes', item: 15, group: 'Habits', label: 'Escape closes the preview', description: 'Escape leaves the file preview for the folder, as the folder link in its header does, unless a menu, dialog or other layer is open. Both return to the folder\'s listing with the view and sort it had.', ready: true },
  { id: 't15-return-focus', item: 15, group: 'Habits', label: 'Focus returns to the last file', description: 'Leaving the preview focuses the row of the last file it showed.', ready: true },
  { id: 't15-arrow-keys', item: 15, group: 'Habits', label: 'Arrows work after a header click', description: 'Left and right arrows step through files even after a click on a button in the preview header.', ready: true },
  { id: 't16-drag-move', item: 16, group: 'Habits', label: 'Drag items to move them', description: 'With a mouse, dragging an item by its name in a list, or by its card in a grid, moves it, or the selection it is in, to a folder, a breadcrumb, My files, Organization files or Trash; elsewhere on a row a drag still selects.', ready: true },
  { id: 't17-show-in-folder', item: 17, group: 'Habits', label: 'Show in folder', description: 'In search and views, the row menu has "Show in folder", which opens the item\'s folder with the item focused and highlighted.', ready: true },
  { id: 't17-recent-location', item: 17, group: 'Habits', label: 'Recent shows where items live', description: 'Recent rows show their folder path, as search, Shared with me and Starred do.', ready: true },
  { id: 't18-hover-checkbox', item: 18, group: 'Habits', label: 'Checkboxes on hover', description: 'With a mouse, hovering an item shows its checkbox in place of the type icon, the list always shows Select all, and a card\'s checkbox is a labelled control.', ready: true },
  { id: 't18-select-entry', item: 18, group: 'Habits', label: '"Select" starts an empty selection', description: 'On a touch screen, "Select" in the "…" menu starts selecting with nothing checked, in place of "Select rows".', ready: true },
  { id: 't19-sort-direction', item: 19, group: 'Habits', label: 'Newest and largest first', description: 'Choosing Modified or Size, in a column header or in Sort by, starts with the newest or largest.', ready: true },
  { id: 't19-owner-sort', item: 19, group: 'Habits', label: 'No Owner sort in My files', description: 'In My files and its folders, Sort by does not offer Owner, and a saved Owner sort reads by name.', ready: true },
  { id: 't20-loaded-label', item: 20, group: 'Habits', label: 'Say when only loaded items are selected', description: 'When more items are still to load, Select all reads "N loaded items selected" instead of "N selected".', ready: true },
  { id: 't22-coalesce', item: 22, group: 'Performance', label: 'One refresh per burst of changes', description: 'Change events that arrive within 400 ms of the first one cause one refresh, not one each.', ready: true },
  { id: 't22-recent-only', item: 22, group: 'Performance', label: 'Opening an item refreshes only Recent', description: 'Opening a folder or file refreshes only the Recent lists in your tabs, not every Drive list on the page.', ready: true },
  { id: 't24-theme-nonblocking', item: 24, group: 'Performance', label: 'Page shows before the theme check', description: 'The page appears in the theme it was served with, without waiting to read your saved theme again.', ready: true },
  { id: 't24-preload-routes', item: 24, group: 'Performance', label: 'Page code loads during sign-in checks', description: 'The code of the page you opened starts loading while the session and translations load, not after.', ready: true },
  { id: 't24-palette-no-mail', item: 24, group: 'Performance', label: 'No Mail requests outside Mail', description: 'The command palette no longer loads your mail account on every page.', ready: true },
  { id: 't24-boot-roots', item: 24, group: 'Performance', label: 'My files lists at once', description: 'The page arrives knowing your My files and Organization files folders, so the list starts loading without asking for them first.', ready: true },
  { id: 't25-preview-refresh', item: 25, group: 'Performance', label: 'Thumbnails stay loaded on focus', description: 'The grid and Home renew thumbnails only shortly before they expire, not on every return to the window.', ready: true },
  { id: 't26-optimistic-remove', item: 26, group: 'Performance', label: 'Trash and move leave the list at once', description: 'Trashed and moved items, one or many, and restored selections leave the list before the server answers, and come back in place if it refuses.', ready: true },
  { id: 't26-insert-created', item: 26, group: 'Performance', label: 'New folder shows without a reload', description: 'A new folder or link appears in its sorted place as soon as it is created, without waiting for the list to load again.', ready: true },
  { id: 't26-pending-sort', item: 26, group: 'Performance', label: 'A new sort shows it is loading', description: 'While a new sort or search term loads, the old rows dim, so you can tell new ones are coming.', ready: true },
  { id: 't27-preview-preload', item: 27, group: 'Performance', label: 'Next image ready', description: 'The preview keeps the next and previous images loaded, so the arrows show them at once.', ready: true },
  { id: 't27-image-loading', item: 27, group: 'Performance', label: 'Image and video loading states', description: 'Images fade in, a spinner shows after a short wait, and a failed image or video offers Download.', ready: true },
  { id: 't27-pager-space', item: 27, group: 'Performance', label: 'Pager keeps its place', description: 'The preview keeps room for the pager while the folder loads, so the header does not shift.', ready: true },
  { id: 't28-cancel-upload', item: 28, group: 'Slow operations', label: 'Cancel uploads', description: 'Each upload has a Cancel button, and the tracker has Cancel all. A cancelled upload stays in the list with Retry.', ready: true },
  { id: 't28-chunk-retry', item: 28, group: 'Slow operations', label: 'Uploads survive a dropped connection', description: 'When the connection drops, uploads say "Connection lost. Retrying…" and continue where they stopped, instead of failing.', ready: true },
  { id: 't29-leave-warning', item: 29, group: 'Slow operations', label: 'Warn before closing mid-upload', description: 'Closing or reloading the tab while files upload or wait to upload asks first.', ready: true },
  { id: 't29-reopen-tracker', item: 29, group: 'Slow operations', label: 'Tracker opens after a reload', description: 'After a reload with stopped uploads, the upload tracker opens by itself and says how many stopped.', ready: true },
  { id: 't29-resume-all', item: 29, group: 'Slow operations', label: 'Resume all', description: 'With two or more stopped uploads, Resume all continues them, from one file picker for those that need one.', ready: true },
  { id: 't29-attention-off-screen', item: 29, group: 'Slow operations', label: 'Red dot outside Drive', description: 'An upload that fails while you are outside Drive raises the red dot on Drive, even with the tracker left open.', ready: true },
  { id: 't30-overall-progress', item: 30, group: 'Slow operations', label: 'Upload summary', description: 'The upload tracker header sums up the run, with bytes sent and an overall progress bar.', ready: true },
  { id: 't30-time-left', item: 30, group: 'Slow operations', label: 'Upload time left', description: 'The upload summary adds an estimate such as "About 3 minutes left"; it needs Upload summary.', ready: true },
  { id: 't30-open-finished', item: 30, group: 'Slow operations', label: 'Finished uploads open', description: 'The name of a finished upload links to the file.', ready: true },
  { id: 't30-reading-folder', item: 30, group: 'Slow operations', label: 'Reading a dropped folder', description: 'The tracker shows the files found while a dropped folder is read, and says when it cannot be read.', ready: true },
  { id: 't30-messages', item: 30, group: 'Slow operations', label: 'Clearer upload messages', description: 'Long upload errors wrap to two lines, and storage messages say what to do in plain words.', ready: true },
  { id: 't30-steady-chunks', item: 30, group: 'Slow operations', label: 'Steadier upload progress', description: 'Large files upload in small pieces at first, so the progress bar moves on a slow connection.', ready: true },
  { id: 't31-toast-closes', item: 31, group: 'Slow operations', label: 'Zip toast closes', description: 'The "Preparing … for download" toast closes a few seconds after the zip starts downloading, and says its size.', ready: true },
  { id: 't31-poll-survives', item: 31, group: 'Slow operations', label: 'Zip wait survives a dropped connection', description: 'While a zip is prepared, a dropped connection shows "Waiting for connection…" and Drive keeps waiting for the zip, instead of failing.', ready: true },
  { id: 't31-bell-read', item: 31, group: 'Slow operations', label: 'Downloaded zips are marked read', description: 'A zip this tab started downloading is marked read in the bell, so the badge counts only zips that nobody has downloaded yet.', ready: true },
  { id: 't31-bell-details', item: 31, group: 'Slow operations', label: 'Zip size and expiry in the bell', description: 'A ready zip in the bell shows its size and the date until which you can download it.', ready: true },
  { id: 't32-readable-failures', item: 32, group: 'Slow operations', label: 'Readable partial failures', description: 'A partial bulk failure names its items with their icons and says why each failed, such as "2 of 5 items could not be moved".', ready: true },
  { id: 't33-confirm-irreversible', item: 33, group: 'Slow operations', label: 'Ask before what cannot be undone', description: 'Deleting a live link and "Remove here and inside" ask first.', ready: true },
  { id: 't33-undo-remove', item: 33, group: 'Slow operations', label: 'Undo after Remove', description: 'After a plain Remove, the share dialog offers Undo, which puts the role back without an email.', ready: true },
  { id: 't33-public-folder-wording', item: 33, group: 'Slow operations', label: 'Clear public wording', description: 'A public folder says everything in it is public, and Copy link says anyone with the link can view.', ready: true },
  { id: 't34-bulk-trash-confirm', item: 34, group: 'Slow operations', label: 'Ask before trashing several items', description: 'Moving two or more items to Trash, by any route, first asks with the count; one item still goes at once with Undo.', ready: true },
  { id: 't35-default-columns', item: 35, group: 'Habits', label: 'Type and Size shown by default', description: 'The list shows Modified, Type and Size to anyone who has not chosen columns, and keeps the columns a user did choose.', ready: true },
  { id: 't36-access-column', item: 36, group: 'Habits', label: 'Access column', description: 'The list shows how widely each item is shared, such as "Only you", "3 people" or "Public", and a click on it opens Share.', ready: true },
  { id: 't37-checkbox-near', item: 37, group: 'Habits', label: 'Checkbox near the name', description: 'With a mouse, an item\'s checkbox shows only while the pointer is over its icon and name, or a card\'s corner and title, and always with keyboard focus.', ready: true },
  { id: 't41-company-files', item: 41, group: 'Merge similar concepts', label: 'Company name on the shared root', description: 'Drive names the Organization files root after your company, such as "Northwind Labs files", wherever it shows.', ready: true },
  { id: 't45-home-new', item: 45, group: 'Fewer steps', label: 'New cards on Home', description: 'Home shows a New section above Recent with one card each to create a document, spreadsheet, presentation or drawing in My files.', ready: true },
] as const satisfies readonly Tweak[]

/** Adds Drive's ids to `TweakId`, so platform code can read a Drive tweak by a checked id. */
declare module '@/platform/tweaks' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging needs an interface
  interface TweakIds extends Record<(typeof tweaks)[number]['id'], true> {}
}
