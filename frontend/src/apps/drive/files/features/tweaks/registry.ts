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
  { id: 't1', item: 1, group: 'Bugs', label: 'No false "Change your own access?" warning', description: 'Changing the workspace access as the owner no longer asks whether you want to change your own access.', ready: false },
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
  { id: 't9', item: 9, group: 'Fewer steps', label: 'Share link in one click', description: 'A visible "New link" button creates a view link and copies it.', ready: true },
  { id: 't10', item: 10, group: 'Fewer steps', label: 'Desktop share footer', description: 'The desktop share dialog footer has a captioned Copy link and a Done button, like the phone layout.', ready: true },
  { id: 't11', item: 11, group: 'Fewer steps', label: 'Simpler duplicate-name dialog', description: 'The duplicate-name dialog has one Skip and shows the New name field only when you choose Rename.', ready: false },
  { id: 't12', item: 12, group: 'Fewer steps', label: 'Empty states with actions', description: 'Each empty view has its sidebar icon, an empty folder offers an "Upload files" button, and an empty search offers "Clear search".', ready: true },
  { id: 't13-arrow-keys', item: 13, group: 'Habits', label: 'Arrow keys move in the list', description: 'The list and the grid are one Tab stop, the arrow keys, Home and End move focus, Shift with them selects a range, and Space selects a card.', ready: true },
  { id: 't13-type-ahead', item: 13, group: 'Habits', label: 'Type to jump', description: 'Typing the start of a name moves focus to the next item with that name.', ready: true },
  { id: 't14-delete-key', item: 14, group: 'Habits', label: 'Delete key moves to Trash', description: 'Delete, like Mod+Backspace, moves the items to Trash, and in Trash deletes them forever after asking.', ready: true },
  { id: 't14-rename-key', item: 14, group: 'Habits', label: 'F2 renames', description: 'F2 opens Rename for the one item it acts on.', ready: true },
  { id: 't14-parent-key', item: 14, group: 'Habits', label: 'Alt+Up opens the parent folder', description: 'Alt+Up, or Cmd+Up on a Mac, opens the folder above and focuses the folder you came from.', ready: true },
  { id: 't14-undo-key', item: 14, group: 'Habits', label: 'Mod+Z undoes', description: 'Mod+Z runs the Undo of the newest change toast still on screen.', ready: true },
  { id: 't14-focused-row', item: 14, group: 'Habits', label: 'Keys act on the focused row', description: 'With nothing selected, Delete, F2, Share and Open in new tab act on the row that shows keyboard focus.', ready: true },
  { id: 't15', item: 15, group: 'Habits', label: 'Escape closes the preview', description: 'Escape and a close button leave the file preview, and focus returns to the row that was open.', ready: false },
  { id: 't16', item: 16, group: 'Habits', label: 'Drag rows to move them', description: 'Dragging a row moves it to a folder, breadcrumb or sidebar location; the selection box starts only from empty space.', ready: false },
  { id: 't17', item: 17, group: 'Habits', label: 'Show in folder', description: 'In search and views, the path links to the parent folder and the row menu has "Show in folder".', ready: false },
  { id: 't18', item: 18, group: 'Habits', label: 'Checkboxes on hover', description: 'Hovering a row shows its checkbox in place of the type icon, and "Select rows" is gone.', ready: false },
  { id: 't19-sort-direction', item: 19, group: 'Habits', label: 'Newest and largest first', description: 'Choosing Modified or Size, in a column header or in Sort by, starts with the newest or largest.', ready: true },
  { id: 't19-owner-sort', item: 19, group: 'Habits', label: 'No Owner sort in My files', description: 'In My files and its folders, Sort by does not offer Owner, and a saved Owner sort reads by name.', ready: true },
  { id: 't20', item: 20, group: 'Habits', label: 'Select all means all', description: 'Select all loads the remaining pages first, or says how many loaded items it selected.', ready: false },
  { id: 't22-coalesce', item: 22, group: 'Performance', label: 'One refresh per burst of changes', description: 'Change events that arrive within 400 ms of the first one cause one refresh, not one each.', ready: true },
  { id: 't22-recent-only', item: 22, group: 'Performance', label: 'Opening an item refreshes only Recent', description: 'Opening a folder or file refreshes only the Recent lists in your tabs, not every Drive list on the page.', ready: true },
  { id: 't24-theme-nonblocking', item: 24, group: 'Performance', label: 'Page shows before the theme check', description: 'The page appears in the theme it was served with, without waiting to read your saved theme again.', ready: true },
  { id: 't24-preload-routes', item: 24, group: 'Performance', label: 'Page code loads during sign-in checks', description: 'The code of the page you opened starts loading while the session and translations load, not after.', ready: true },
  { id: 't24-palette-no-mail', item: 24, group: 'Performance', label: 'No Mail requests outside Mail', description: 'The command palette no longer loads your mail account on every page.', ready: true },
  { id: 't25', item: 25, group: 'Performance', label: 'Thumbnails stay loaded on focus', description: 'The grid refreshes thumbnails only when they are about to expire, and loads them lazily.', ready: false },
  { id: 't26', item: 26, group: 'Performance', label: 'Trash, move and new folder show at once', description: 'Trashed and moved items leave the list and a new folder appears before the server answers.', ready: false },
  { id: 't27', item: 27, group: 'Performance', label: 'Smoother preview', description: 'The preview loads the next and previous image ahead, fades images in and keeps the pager in place.', ready: false },
  { id: 't28', item: 28, group: 'Slow operations', label: 'Cancel uploads and retry on drop', description: 'Uploads can be cancelled or removed, and a failed chunk retries when the connection returns.', ready: false },
  { id: 't29', item: 29, group: 'Slow operations', label: 'Warn before closing mid-upload', description: 'Closing the tab during an upload asks first, and after a reload the tracker offers Resume all.', ready: false },
  { id: 't30', item: 30, group: 'Slow operations', label: 'Upload progress and links', description: 'The upload tracker shows overall progress and time left, and finished rows open the file.', ready: false },
  { id: 't31', item: 31, group: 'Slow operations', label: 'Zip downloads tidy up', description: 'The zip toast closes when the file arrives, and the bell has no unread entry for a download this tab started.', ready: false },
  { id: 't32', item: 32, group: 'Slow operations', label: 'Readable partial failures', description: 'A partial bulk failure names the items with their icons, such as "2 of 5 items could not be moved".', ready: false },
  { id: 't33', item: 33, group: 'Slow operations', label: 'Safer public access and link actions', description: 'Making a folder public and deleting a link ask first, and both offer Undo.', ready: false },
] as const satisfies readonly Tweak[]

/** Adds Drive's ids to `TweakId`, so platform code can read a Drive tweak by a checked id. */
declare module '@/platform/tweaks' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging needs an interface
  interface TweakIds extends Record<(typeof tweaks)[number]['id'], true> {}
}
