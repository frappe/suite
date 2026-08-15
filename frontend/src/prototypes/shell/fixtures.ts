// PROTOTYPE — remove. Fake data for the throwaway workspace-shell prototype.
// Nothing here persists or talks to the backend.

export const WORKSPACE = { name: 'Frappe' }

// Two workspaces only, to ask whether the switcher belongs in the sidebar at
// all. `kind` is the subtitle line, so the org and the personal one are
// tellable apart without an avatar.
export const WORKSPACES = [
  { id: 'frappe', name: 'Frappe', kind: 'Organization' },
  { id: 'personal', name: 'Personal', kind: 'Just you' },
]
export const USER = {
  name: 'Faris',
  initial: 'F',
  avatar: 'https://avatars.githubusercontent.com/u/9355208?v=4',
}

export type AreaId = 'home' | 'files' | 'mail' | 'calendar'

export const NAV_ITEMS: { id: AreaId; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'lucide-home' },
  { id: 'files', label: 'Files', icon: 'lucide-folder' },
  { id: 'mail', label: 'Mail', icon: 'lucide-mail' },
  { id: 'calendar', label: 'Calendar', icon: 'lucide-calendar' },
]

export type DocKind = 'writer' | 'sheet' | 'slides' | 'pdf'

export const DOC_KIND_META: Record<
  DocKind,
  { icon: string; tint: string; label: string }
> = {
  writer: { icon: 'lucide-file-text', tint: 'text-ink-blue-6', label: 'Document' },
  sheet: { icon: 'lucide-table', tint: 'text-ink-green-6', label: 'Spreadsheet' },
  slides: { icon: 'lucide-presentation', tint: 'text-ink-orange-6', label: 'Presentation' },
  pdf: { icon: 'lucide-file', tint: 'text-ink-red-6', label: 'PDF' },
}

export interface RecentDoc {
  id: string
  name: string
  kind: DocKind
  opened: string
}

export const RECENT_DOCS: RecentDoc[] = [
  { id: 'd1', name: 'Q3 planning notes', kind: 'writer', opened: 'opened 12m ago' },
  { id: 'd2', name: 'Hiring pipeline', kind: 'sheet', opened: 'opened 1h ago' },
  { id: 'd3', name: 'Suite launch deck', kind: 'slides', opened: 'opened 2h ago' },
  { id: 'd4', name: 'Vendor contract.pdf', kind: 'pdf', opened: 'opened 3h ago' },
  { id: 'd5', name: 'Meeting minutes — 14 Aug', kind: 'writer', opened: 'opened yesterday' },
  { id: 'd6', name: 'Expense tracker', kind: 'sheet', opened: 'opened yesterday' },
  { id: 'd7', name: 'Design review deck', kind: 'slides', opened: 'opened 2d ago' },
  { id: 'd8', name: 'Onboarding checklist', kind: 'writer', opened: 'opened 3d ago' },
]

export interface UpcomingEvent {
  id: string
  title: string
  day: 'Today' | 'Tomorrow'
  time: string
  meet: boolean
  /** Column in the week grid, Monday = 0. */
  dayIndex: number
  /** Decimal hours, grid runs 8:00–18:00. */
  startHour: number
  endHour: number
}

export const UPCOMING_EVENTS: UpcomingEvent[] = [
  { id: 'e1', title: 'Design review', day: 'Today', time: '10:00 – 11:00', meet: true, dayIndex: 5, startHour: 10, endHour: 11 },
  { id: 'e2', title: '1:1 Faris / Rushabh', day: 'Today', time: '14:00 – 14:30', meet: true, dayIndex: 5, startHour: 14, endHour: 14.5 },
  { id: 'e3', title: 'Sprint planning', day: 'Tomorrow', time: '09:30 – 10:30', meet: false, dayIndex: 6, startHour: 9.5, endHour: 10.5 },
  { id: 'e4', title: 'Dentist', day: 'Tomorrow', time: '16:00 – 17:00', meet: false, dayIndex: 6, startHour: 16, endHour: 17 },
]

export interface Mailbox {
  id: string
  label: string
  icon: string
  unread?: number
}

export const MAILBOXES: Mailbox[] = [
  { id: 'inbox', label: 'Inbox', icon: 'lucide-inbox', unread: 12 },
  { id: 'sent', label: 'Sent', icon: 'lucide-send' },
  { id: 'drafts', label: 'Drafts', icon: 'lucide-pencil-line' },
  { id: 'archive', label: 'Archive', icon: 'lucide-archive' },
  { id: 'spam', label: 'Spam', icon: 'lucide-octagon-alert' },
  { id: 'trash', label: 'Trash', icon: 'lucide-trash-2' },
]

export interface MailThread {
  id: string
  from: string
  subject: string
  snippet: string
  time: string
  unread: boolean
}

export const MAIL_THREADS: MailThread[] = [
  { id: 't1', from: 'Rushabh Mehta', subject: 'Suite shell direction', snippet: 'I think the contextual swap feels closer to what we discussed…', time: '09:41', unread: true },
  { id: 't2', from: 'GitHub', subject: '[frappe/suite] PR #482 merged', snippet: 'feat(shell): unified workspace sidebar — merged by faris…', time: '09:12', unread: true },
  { id: 't3', from: 'Priya Nair', subject: 'Calendar sync bug', snippet: 'The recurring events duplicate when the timezone changes…', time: '08:55', unread: true },
  { id: 't4', from: 'Frappe Cloud', subject: 'Your invoice for August', snippet: 'Invoice INV-2026-0812 for suite.frappe.cloud is ready…', time: 'Yesterday', unread: false },
  { id: 't5', from: 'Aditya Verma', subject: 'Re: Design tokens audit', snippet: 'All seven frontends now use the semantic ramps, except…', time: 'Yesterday', unread: false },
  { id: 't6', from: 'Stalwart', subject: 'Weekly mail report', snippet: '312 messages delivered, 4 greylisted, 0 bounced…', time: 'Yesterday', unread: false },
  { id: 't7', from: 'Neha Kulkarni', subject: 'Slides templates', snippet: 'Uploaded the new pitch templates to the shared folder…', time: 'Wed', unread: false },
  { id: 't8', from: 'Crowdin', subject: 'New translations ready', snippet: '48 strings translated into German and French await review…', time: 'Wed', unread: false },
  { id: 't9', from: 'Rushabh Mehta', subject: 'Offsite agenda', snippet: 'Draft agenda for the September offsite, comments welcome…', time: 'Tue', unread: false },
  { id: 't10', from: 'Sentry', subject: 'New issue in suite-frontend', snippet: "TypeError: Cannot read properties of undefined (reading 'id')…", time: 'Mon', unread: false },
]

export interface FileRow {
  id: string
  name: string
  kind: DocKind | 'folder'
  owner: string
  modified: string
  /** Backs the Modified sort — the `modified` label is prose and can't sort. */
  minutesAgo: number
  /** Parent folder id; `null` sits at the root of the tree. */
  parent: string | null
  shared?: boolean
  starred?: boolean
  trashed?: boolean
}

// A real tree, not a flat list: `parent` is the only structure, so the Files
// area can walk it to any depth. Deepest branch is Product / Roadmap / Q3.
export const FILES: FileRow[] = [
  // Root
  { id: 'f1', name: 'Product', kind: 'folder', parent: null, owner: 'Faris', modified: '2d ago', minutesAgo: 2880 },
  { id: 'f2', name: 'Design', kind: 'folder', parent: null, owner: 'Neha Kulkarni', modified: '5d ago', minutesAgo: 7200, shared: true },
  { id: 'f13', name: 'Operations', kind: 'folder', parent: null, owner: 'Priya Nair', modified: '4d ago', minutesAgo: 5760, shared: true },
  { id: 'f3', name: 'Q3 planning notes', kind: 'writer', parent: null, owner: 'Faris', modified: '12m ago', minutesAgo: 12, starred: true },
  { id: 'f4', name: 'Hiring pipeline', kind: 'sheet', parent: null, owner: 'Priya Nair', modified: '1h ago', minutesAgo: 60, shared: true },
  { id: 'f5', name: 'Suite launch deck', kind: 'slides', parent: null, owner: 'Faris', modified: '2h ago', minutesAgo: 120, starred: true },
  { id: 'f6', name: 'Vendor contract.pdf', kind: 'pdf', parent: null, owner: 'Rushabh Mehta', modified: '3h ago', minutesAgo: 180, shared: true },
  { id: 'f7', name: 'Meeting minutes — 14 Aug', kind: 'writer', parent: null, owner: 'Aditya Verma', modified: 'yesterday', minutesAgo: 1440, shared: true },
  { id: 'f8', name: 'Expense tracker', kind: 'sheet', parent: null, owner: 'Faris', modified: 'yesterday', minutesAgo: 1500 },
  { id: 'f9', name: 'Design review deck', kind: 'slides', parent: null, owner: 'Neha Kulkarni', modified: '2d ago', minutesAgo: 2940, shared: true, starred: true },
  { id: 'f10', name: 'Onboarding checklist', kind: 'writer', parent: null, owner: 'Faris', modified: '3d ago', minutesAgo: 4320, starred: true },

  // Product
  { id: 'p1', name: 'Roadmap', kind: 'folder', parent: 'f1', owner: 'Faris', modified: '6h ago', minutesAgo: 360 },
  { id: 'p2', name: 'Specs', kind: 'folder', parent: 'f1', owner: 'Aditya Verma', modified: '1d ago', minutesAgo: 1380, shared: true },
  { id: 'p3', name: 'Product brief', kind: 'writer', parent: 'f1', owner: 'Faris', modified: '4h ago', minutesAgo: 240, starred: true },
  { id: 'p4', name: 'Pricing model', kind: 'sheet', parent: 'f1', owner: 'Rushabh Mehta', modified: '2d ago', minutesAgo: 3000, shared: true },

  // Product / Roadmap
  { id: 'r1', name: 'Q3', kind: 'folder', parent: 'p1', owner: 'Faris', modified: '30m ago', minutesAgo: 30 },
  { id: 'r2', name: 'Q4', kind: 'folder', parent: 'p1', owner: 'Faris', modified: '5h ago', minutesAgo: 300 },
  { id: 'r3', name: 'Roadmap overview', kind: 'writer', parent: 'p1', owner: 'Rushabh Mehta', modified: '1d ago', minutesAgo: 1560, shared: true, starred: true },

  // Product / Roadmap / Q3
  { id: 'q1', name: 'Q3 objectives', kind: 'writer', parent: 'r1', owner: 'Faris', modified: '30m ago', minutesAgo: 30, starred: true },
  { id: 'q2', name: 'Q3 metrics', kind: 'sheet', parent: 'r1', owner: 'Priya Nair', modified: '2h ago', minutesAgo: 150, shared: true },
  { id: 'q3', name: 'Q3 review deck', kind: 'slides', parent: 'r1', owner: 'Faris', modified: '1d ago', minutesAgo: 1620 },

  // Product / Roadmap / Q4
  { id: 'q4', name: 'Q4 objectives', kind: 'writer', parent: 'r2', owner: 'Faris', modified: '5h ago', minutesAgo: 300 },
  { id: 'q5', name: 'Q4 budget', kind: 'sheet', parent: 'r2', owner: 'Aditya Verma', modified: '3d ago', minutesAgo: 4400, shared: true },

  // Product / Specs
  { id: 's1', name: 'Auth spec', kind: 'writer', parent: 'p2', owner: 'Aditya Verma', modified: '1d ago', minutesAgo: 1400, shared: true },
  { id: 's2', name: 'Billing spec', kind: 'writer', parent: 'p2', owner: 'Aditya Verma', modified: '2d ago', minutesAgo: 3100, shared: true },
  { id: 's3', name: 'Search spec', kind: 'writer', parent: 'p2', owner: 'Faris', modified: '6d ago', minutesAgo: 8640 },

  // Design
  { id: 'd1', name: 'Brand', kind: 'folder', parent: 'f2', owner: 'Neha Kulkarni', modified: '3d ago', minutesAgo: 4500, shared: true },
  { id: 'd2', name: 'Mockups', kind: 'folder', parent: 'f2', owner: 'Neha Kulkarni', modified: '8h ago', minutesAgo: 480, shared: true },
  { id: 'd3', name: 'Component audit', kind: 'sheet', parent: 'f2', owner: 'Neha Kulkarni', modified: '2d ago', minutesAgo: 2900, shared: true },
  { id: 'd4', name: 'Icon set.pdf', kind: 'pdf', parent: 'f2', owner: 'Neha Kulkarni', modified: '5d ago', minutesAgo: 7300, shared: true },

  // Design / Brand
  { id: 'b1', name: 'Logo guidelines.pdf', kind: 'pdf', parent: 'd1', owner: 'Neha Kulkarni', modified: '3d ago', minutesAgo: 4500, shared: true },
  { id: 'b2', name: 'Colour tokens', kind: 'sheet', parent: 'd1', owner: 'Faris', modified: '1w ago', minutesAgo: 10080, starred: true },

  // Design / Mockups
  { id: 'm1', name: 'Shell mockups', kind: 'slides', parent: 'd2', owner: 'Neha Kulkarni', modified: '8h ago', minutesAgo: 480, shared: true, starred: true },
  { id: 'm2', name: 'Mobile mockups', kind: 'slides', parent: 'd2', owner: 'Neha Kulkarni', modified: '2d ago', minutesAgo: 3200, shared: true },
  { id: 'm3', name: 'Dark mode mockups', kind: 'slides', parent: 'd2', owner: 'Faris', modified: '4d ago', minutesAgo: 5900 },

  // Operations
  { id: 'o1', name: 'HR', kind: 'folder', parent: 'f13', owner: 'Priya Nair', modified: '2d ago', minutesAgo: 3300, shared: true },
  // Deliberately empty, so the empty state is reachable by clicking.
  { id: 'o2', name: 'Archive', kind: 'folder', parent: 'f13', owner: 'Priya Nair', modified: '1mo ago', minutesAgo: 43200 },
  { id: 'o3', name: 'Vendor list', kind: 'sheet', parent: 'f13', owner: 'Priya Nair', modified: '4d ago', minutesAgo: 5760, shared: true },
  { id: 'o4', name: 'Office lease.pdf', kind: 'pdf', parent: 'f13', owner: 'Rushabh Mehta', modified: '2w ago', minutesAgo: 20200 },

  // Operations / HR
  { id: 'h1', name: 'Hiring plan', kind: 'writer', parent: 'o1', owner: 'Priya Nair', modified: '2d ago', minutesAgo: 3300, shared: true },
  { id: 'h2', name: 'Interview rubric', kind: 'writer', parent: 'o1', owner: 'Aditya Verma', modified: '1w ago', minutesAgo: 10100, shared: true },

  // Trash spans the tree, so it is a view rather than a place.
  { id: 't1f', name: 'Archive 2025', kind: 'folder', parent: null, owner: 'Faris', modified: '2w ago', minutesAgo: 20160, trashed: true },
  { id: 't2f', name: 'Old roadmap', kind: 'writer', parent: 'p1', owner: 'Faris', modified: '3w ago', minutesAgo: 30240, trashed: true },
]

/** Owner faces, so the Files list reads as real data instead of initials. */
export const PEOPLE: Record<string, string> = {
  Faris: USER.avatar,
  'Neha Kulkarni': 'https://avatars.githubusercontent.com/u/583231?v=4',
  'Priya Nair': 'https://avatars.githubusercontent.com/u/1?v=4',
  'Aditya Verma': 'https://avatars.githubusercontent.com/u/2?v=4',
  'Rushabh Mehta': 'https://avatars.githubusercontent.com/u/4?v=4',
}

/** Every owner in the tree, for the Files filter's Owner field. */
export const OWNERS = [...new Set(FILES.map((file) => file.owner))].sort()

export const FOLDERS = [
  { id: 'all', label: 'All files', icon: 'lucide-folder' },
  { id: 'shared', label: 'Shared with me', icon: 'lucide-users' },
  { id: 'starred', label: 'Starred', icon: 'lucide-star' },
  { id: 'trash', label: 'Trash', icon: 'lucide-trash-2' },
]

const BY_ID = new Map(FILES.map((file) => [file.id, file]))

/** Rows inside one folder. `null` is the root. Trashed rows live only in Trash. */
export function childrenOf(parentId: string | null): FileRow[] {
  return FILES.filter((file) => file.parent === parentId && !file.trashed)
}

/**
 * Sidebar saved views cut across the whole tree, so they are flat. "All files"
 * is the tree root, which is what makes descending from it feel continuous.
 */
export function filesInView(viewId: string): FileRow[] {
  if (viewId === 'trash') return FILES.filter((file) => file.trashed)
  const live = FILES.filter((file) => !file.trashed)
  if (viewId === 'shared') return live.filter((file) => file.shared)
  if (viewId === 'starred') return live.filter((file) => file.starred)
  return childrenOf(null)
}

/** Ancestor chain for a row, root first, ending with the row itself. */
export function pathTo(id: string): FileRow[] {
  const chain: FileRow[] = []
  let current = BY_ID.get(id)
  while (current) {
    chain.unshift(current)
    current = current.parent ? BY_ID.get(current.parent) : undefined
  }
  return chain
}

export const CALENDARS = [
  { id: 'work', label: 'Work', dot: 'bg-surface-blue-5' },
  { id: 'personal', label: 'Personal', dot: 'bg-surface-green-5' },
]

/** Week of Mon 10 – Sun 16 Aug 2026; "today" is Sat 15. */
export const WEEK_DAYS = [
  { label: 'Mon', date: 10, today: false },
  { label: 'Tue', date: 11, today: false },
  { label: 'Wed', date: 12, today: false },
  { label: 'Thu', date: 13, today: false },
  { label: 'Fri', date: 14, today: false },
  { label: 'Sat', date: 15, today: true },
  { label: 'Sun', date: 16, today: false },
]

export const NEW_MENU_ITEMS = [
  { label: 'Document', icon: 'lucide-file-text', onClick: () => {} },
  { label: 'Spreadsheet', icon: 'lucide-table', onClick: () => {} },
  { label: 'Presentation', icon: 'lucide-presentation', onClick: () => {} },
  { label: 'Meeting', icon: 'lucide-video', onClick: () => {} },
  { label: 'Upload', icon: 'lucide-upload', onClick: () => {} },
]
