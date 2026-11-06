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
  { id: 't4', item: 4, group: 'Merge similar concepts', label: 'One name per thing', description: 'Types, locations, access levels and storage use the same words everywhere.', ready: false },
  { id: 't5', item: 5, group: 'Merge similar concepts', label: 'One way to change a role', description: 'Every role menu in the share dialog lists the roles at the top with a check, in one control style.', ready: false },
  { id: 't6', item: 6, group: 'Merge similar concepts', label: 'One byte format', description: 'The listing and the upload tracker show sizes with the same units.', ready: false },
  { id: 't7', item: 7, group: 'Merge similar concepts', label: 'One "Folder" in the New menu', description: 'The New menu\'s upload items say "Upload files" and "Upload folder", so only Create has "Folder".', ready: true },
  { id: 't8', item: 8, group: 'Fewer steps', label: 'New document opens at once', description: 'A new document, spreadsheet, presentation or drawing opens with the default title instead of asking for a name.', ready: false },
  { id: 't9', item: 9, group: 'Fewer steps', label: 'Share link in one click', description: 'A visible "New link" button creates a view link and copies it.', ready: false },
  { id: 't10', item: 10, group: 'Fewer steps', label: 'Desktop share footer', description: 'The desktop share dialog footer has a captioned Copy link and a Done button, like the phone layout.', ready: false },
  { id: 't11', item: 11, group: 'Fewer steps', label: 'Simpler duplicate-name dialog', description: 'The duplicate-name dialog has one Skip and shows the New name field only when you choose Rename.', ready: false },
  { id: 't12', item: 12, group: 'Fewer steps', label: 'Empty states with actions', description: 'Each empty view has its own icon, and an empty folder offers New and Upload buttons.', ready: false },
  { id: 't13', item: 13, group: 'Habits', label: 'Arrow keys move in the list', description: 'The list is one Tab stop, and the arrow keys, Home, End and typing move between rows.', ready: false },
  { id: 't14', item: 14, group: 'Habits', label: 'Delete, F2 and Undo shortcuts', description: 'Delete moves to Trash, F2 renames, Alt+Up opens the parent folder and Mod+Z undoes, also on the focused row.', ready: false },
  { id: 't15', item: 15, group: 'Habits', label: 'Escape closes the preview', description: 'Escape and a close button leave the file preview, and focus returns to the row that was open.', ready: false },
  { id: 't16', item: 16, group: 'Habits', label: 'Drag rows to move them', description: 'Dragging a row moves it to a folder, breadcrumb or sidebar location; the selection box starts only from empty space.', ready: false },
  { id: 't17', item: 17, group: 'Habits', label: 'Show in folder', description: 'In search and views, the path links to the parent folder and the row menu has "Show in folder".', ready: false },
  { id: 't18', item: 18, group: 'Habits', label: 'Checkboxes on hover', description: 'Hovering a row shows its checkbox in place of the type icon, and "Select rows" is gone.', ready: false },
  { id: 't19', item: 19, group: 'Habits', label: 'Newest and largest first', description: 'Sorting by Modified or Size starts with the newest or largest, and Sort by hides Owner where the column is hidden.', ready: false },
  { id: 't20', item: 20, group: 'Habits', label: 'Select all means all', description: 'Select all loads the remaining pages first, or says how many loaded items it selected.', ready: false },
  { id: 't22', item: 22, group: 'Performance', label: 'Fewer refetches after a change', description: 'Change events are combined, and this tab skips the echo of its own recent write.', ready: false },
  { id: 't23', item: 23, group: 'Performance', label: 'Cache saved once per tick', description: 'The local cache is written once per tick instead of once per stored row.', ready: false },
  { id: 't24', item: 24, group: 'Performance', label: 'Faster cold load', description: 'The first request starts while the local cache loads, and the page shell shows at once.', ready: false },
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
