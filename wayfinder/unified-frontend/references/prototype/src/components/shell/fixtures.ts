// Fake data for the workspace-shell prototype. Nothing here persists or talks
// to a backend.
import { USER_AVATAR } from './userAvatar'

export const WORKSPACE = { name: 'Frappe' }

// Two workspaces only, to ask whether the switcher belongs in the sidebar at
// all. `kind` is the subtitle line, so the org and the personal one are
// tellable apart without an avatar.
// A plain string, not a union of the two seeded ids: the switcher can make
// workspaces, and a new one has no fixture tree behind it. Only 'frappe' and
// 'personal' carry files; every other id resolves to an empty workspace.
export type WorkspaceId = string

export interface Workspace {
  id: WorkspaceId
  name: string
  kind: string
}

// One workspace for now. The switcher is still a list, so a second one costs
// a row here and nothing else.
export const WORKSPACES: Workspace[] = [
  { id: 'arohi', name: 'Arohi’s workspace', kind: 'Organization' },
]
export const USER = {
  name: 'Arohi Mittal',
  initial: 'A',
  avatar: USER_AVATAR,
}

// 'doc' is in no app list: it is where the shell puts an open document, so it
// is reached by clicking a file, never by clicking an app.
export type AreaId =
  | 'home'
  | 'files'
  | 'mail'
  | 'calendar'
  | 'doc'
  | 'writer'
  | 'meet'
  | 'sheets'
  | 'slides'

export interface SuiteApp {
  id: AreaId
  label: string
  icon: string
  /** False for the apps the suite names but this prototype does not build. */
  built: boolean
}

// Home is deliberately absent: the suite's mark in the sidebar header is the
// way home, so a row for it would say the same thing twice.
// Ordered the way the day runs rather than by what is built: the place your
// work lives, then the three apps you make and answer things in, then the
// editors you open from a file rather than from here.
export const APPS: SuiteApp[] = [
  { id: 'files', label: 'Drive', icon: 'lucide-folder', built: true },
  { id: 'writer', label: 'Writer', icon: 'lucide-file-text', built: false },
  { id: 'mail', label: 'Mail', icon: 'lucide-mail', built: true },
  { id: 'calendar', label: 'Calendar', icon: 'lucide-calendar', built: true },
  { id: 'meet', label: 'Meet', icon: 'lucide-video', built: false },
  { id: 'sheets', label: 'Sheets', icon: 'lucide-table', built: false },
  { id: 'slides', label: 'Slides', icon: 'lucide-presentation', built: false },
]

export const HOME_APP: SuiteApp = {
  id: 'home',
  label: 'Home',
  icon: 'lucide-home',
  built: true,
}

/** Every app a tab can name, Home included. */
export const ALL_APPS: SuiteApp[] = [HOME_APP, ...APPS]

// The keyboard order is the built order: Home 1, Drive 2, Mail 3, Calendar 4.
export const NAV_ITEMS: SuiteApp[] = ALL_APPS.filter((app) => app.built)

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

/**
 * A row that "opens a real document" in the original prototype opens this
 * shell's own preview instead — there is no backend here to hold one. `id` is
 * kept only as a stable key.
 */
export type DocApp = 'writer' | 'slides' | 'sheets' | 'pdf'

export interface DocRef {
  app: DocApp
  id: string
}

export function pdfRef(name: string): DocRef {
  return { app: 'pdf', id: name }
}

export const REAL_DOCS = {
  requirements: { app: 'writer', id: '8b85dbc749' },
  onboarding: { app: 'writer', id: 'a2fef4407c' },
  meetingNotes: { app: 'writer', id: '26235c6ce0' },
  longDoc: { app: 'writer', id: '9dcc5a5022' },
  frappeverse: { app: 'slides', id: 'u501ukp0pc' },
  hiring: { app: 'sheets', id: '9kd6k71f47' },
} satisfies Record<string, DocRef>

export const REAL_MEETS = {
  standup: 'cwvn-cnpt-hmmu',
  timeless: 'ndpf-kgxy-scuy',
  designReview: 'xrfo-ejjf-qfce',
  arohi: 'gtmv-jdtm-amxo',
  oneOnOne: 'swsd-hogk-sxpm',
} as const

/** Where a Meet room code lives in the URL. */
export function meetTo(code: string): string {
  return `/meet/${code}`
}

export interface RecentDoc {
  id: string
  name: string
  kind: DocKind
  opened: string
  /** Set when the row opens a document; unset rows stay inert. */
  doc?: DocRef
}

export const RECENT_DOCS: RecentDoc[] = [
  { id: 'd1', name: 'Product Requirements', kind: 'writer', opened: 'opened 12m ago', doc: REAL_DOCS.requirements },
  { id: 'd2', name: 'Hiring pipeline', kind: 'sheet', opened: 'opened 1h ago', doc: REAL_DOCS.hiring },
  { id: 'd3', name: 'Frappe UI Frappeverse 2026', kind: 'slides', opened: 'opened 2h ago', doc: REAL_DOCS.frappeverse },
  { id: 'd4', name: 'Vendor contract.pdf', kind: 'pdf', opened: 'opened 3h ago' },
  { id: 'd5', name: 'Meeting Notes, 14 Aug 2026', kind: 'writer', opened: 'opened yesterday', doc: REAL_DOCS.meetingNotes },
  { id: 'd6', name: 'Expense tracker', kind: 'sheet', opened: 'opened yesterday' },
  { id: 'd7', name: 'Design review deck', kind: 'slides', opened: 'opened 2d ago' },
  { id: 'd8', name: 'Engineering Onboarding', kind: 'writer', opened: 'opened 3d ago', doc: REAL_DOCS.onboarding },
  { id: 'd9', name: 'Shell mockups', kind: 'slides', opened: 'opened 4d ago' },
  { id: 'd10', name: 'Pricing model', kind: 'sheet', opened: 'opened 5d ago' },
  { id: 'd11', name: 'Icon set.pdf', kind: 'pdf', opened: 'opened last week' },
]

export interface UpcomingEvent {
  id: string
  title: string
  day: 'Today' | 'Tomorrow'
  time: string
  /** Room code when the event has a Meet link; unset when it has none. */
  meet?: string
  /** Column in the week grid, Monday = 0. */
  dayIndex: number
  /** Decimal hours, grid runs 8:00–18:00. */
  startHour: number
  endHour: number
}

export const UPCOMING_EVENTS: UpcomingEvent[] = [
  { id: 'e1', title: 'Design review', day: 'Today', time: '10:00 – 11:00', meet: REAL_MEETS.designReview, dayIndex: 5, startHour: 10, endHour: 11 },
  { id: 'e2', title: '1:1 Arohi / Rushabh', day: 'Today', time: '14:00 – 14:30', meet: REAL_MEETS.oneOnOne, dayIndex: 5, startHour: 14, endHour: 14.5 },
  { id: 'e3', title: 'Sprint planning', day: 'Tomorrow', time: '09:30 – 10:30', dayIndex: 6, startHour: 9.5, endHour: 10.5 },
  { id: 'e4', title: 'Dentist', day: 'Tomorrow', time: '16:00 – 17:00', dayIndex: 6, startHour: 16, endHour: 17 },
]

export interface FileRow {
  id: string
  name: string
  kind: DocKind | 'folder'
  owner: string
  modified: string
  /** Backs the Modified sort — the `modified` label is prose and can't sort. */
  minutesAgo: number
  /** Raw size, formatted for the Size column. Folders carry none. */
  bytes?: number
  /** Parent folder id; `null` sits at the root of the tree. */
  parent: string | null
  shared?: boolean
  starred?: boolean
  trashed?: boolean
  doc?: DocRef
}

const FRAPPE_FILES: FileRow[] = [
  // Root
  { id: 'f1', name: 'Product', kind: 'folder', parent: null, owner: 'Arohi Mittal', modified: '2d ago', minutesAgo: 2880 },
  { id: 'f2', name: 'Design', kind: 'folder', parent: null, owner: 'Neha Kulkarni', modified: '5d ago', minutesAgo: 7200, shared: true },
  { id: 'f13', name: 'Operations', kind: 'folder', parent: null, owner: 'Priya Nair', modified: '4d ago', minutesAgo: 5760, shared: true },
  { id: 'f3', name: 'Product Requirements', kind: 'writer', parent: null, owner: 'Arohi Mittal', modified: '12m ago', minutesAgo: 12, bytes: 48_200, starred: true, doc: REAL_DOCS.requirements },
  { id: 'f4', name: 'Hiring pipeline', kind: 'sheet', parent: null, owner: 'Priya Nair', modified: '1h ago', minutesAgo: 60, bytes: 312_000, shared: true, doc: REAL_DOCS.hiring },
  { id: 'f5', name: 'Frappe UI Frappeverse 2026', kind: 'slides', parent: null, owner: 'Arohi Mittal', modified: '2h ago', minutesAgo: 120, bytes: 8_400_000, starred: true, doc: REAL_DOCS.frappeverse },
  { id: 'f6', name: 'Vendor contract.pdf', kind: 'pdf', parent: null, owner: 'Rushabh Mehta', modified: '3h ago', minutesAgo: 180, bytes: 1_260_000, shared: true },
  { id: 'f7', name: 'Meeting Notes, 14 Aug 2026', kind: 'writer', parent: null, owner: 'Aditya Verma', modified: 'yesterday', minutesAgo: 1440, bytes: 22_800, shared: true, doc: REAL_DOCS.meetingNotes },
  { id: 'f8', name: 'Expense tracker', kind: 'sheet', parent: null, owner: 'Arohi Mittal', modified: 'yesterday', minutesAgo: 1500, bytes: 486_000 },
  { id: 'f9', name: 'Design review deck', kind: 'slides', parent: null, owner: 'Neha Kulkarni', modified: '2d ago', minutesAgo: 2940, bytes: 12_700_000, shared: true, starred: true },
  { id: 'f10', name: 'Engineering Onboarding', kind: 'writer', parent: null, owner: 'Arohi Mittal', modified: '3d ago', minutesAgo: 4320, bytes: 64_500, starred: true, doc: REAL_DOCS.onboarding },

  // Product
  { id: 'p1', name: 'Roadmap', kind: 'folder', parent: 'f1', owner: 'Arohi Mittal', modified: '6h ago', minutesAgo: 360 },
  { id: 'p2', name: 'Specs', kind: 'folder', parent: 'f1', owner: 'Aditya Verma', modified: '1d ago', minutesAgo: 1380, shared: true },
  { id: 'p3', name: 'Long Document: Formatting Stress Test', kind: 'writer', parent: 'f1', owner: 'Arohi Mittal', modified: '4h ago', minutesAgo: 240, bytes: 91_300, starred: true, doc: REAL_DOCS.longDoc },
  { id: 'p4', name: 'Pricing model', kind: 'sheet', parent: 'f1', owner: 'Rushabh Mehta', modified: '2d ago', minutesAgo: 3000, bytes: 738_000, shared: true },

  // Product / Roadmap
  { id: 'r1', name: 'Q3', kind: 'folder', parent: 'p1', owner: 'Arohi Mittal', modified: '30m ago', minutesAgo: 30 },
  { id: 'r2', name: 'Q4', kind: 'folder', parent: 'p1', owner: 'Arohi Mittal', modified: '5h ago', minutesAgo: 300 },
  { id: 'r3', name: 'Roadmap overview', kind: 'writer', parent: 'p1', owner: 'Rushabh Mehta', modified: '1d ago', minutesAgo: 1560, bytes: 57_600, shared: true, starred: true },

  // Product / Roadmap / Q3
  { id: 'q1', name: 'Q3 objectives', kind: 'writer', parent: 'r1', owner: 'Arohi Mittal', modified: '30m ago', minutesAgo: 30, bytes: 33_400, starred: true },
  { id: 'q2', name: 'Q3 metrics', kind: 'sheet', parent: 'r1', owner: 'Priya Nair', modified: '2h ago', minutesAgo: 150, bytes: 214_000, shared: true },
  { id: 'q3', name: 'Q3 review deck', kind: 'slides', parent: 'r1', owner: 'Arohi Mittal', modified: '1d ago', minutesAgo: 1620, bytes: 5_900_000 },

  // Product / Roadmap / Q4
  { id: 'q4', name: 'Q4 objectives', kind: 'writer', parent: 'r2', owner: 'Arohi Mittal', modified: '5h ago', minutesAgo: 300, bytes: 28_900 },
  { id: 'q5', name: 'Q4 budget', kind: 'sheet', parent: 'r2', owner: 'Aditya Verma', modified: '3d ago', minutesAgo: 4400, bytes: 402_000, shared: true },

  // Product / Specs
  { id: 's1', name: 'Auth spec', kind: 'writer', parent: 'p2', owner: 'Aditya Verma', modified: '1d ago', minutesAgo: 1400, bytes: 76_100, shared: true },
  { id: 's2', name: 'Billing spec', kind: 'writer', parent: 'p2', owner: 'Aditya Verma', modified: '2d ago', minutesAgo: 3100, bytes: 68_400, shared: true },
  { id: 's3', name: 'Search spec', kind: 'writer', parent: 'p2', owner: 'Arohi Mittal', modified: '6d ago', minutesAgo: 8640, bytes: 52_300 },

  // Design
  { id: 'd1', name: 'Brand', kind: 'folder', parent: 'f2', owner: 'Neha Kulkarni', modified: '3d ago', minutesAgo: 4500, shared: true },
  { id: 'd2', name: 'Mockups', kind: 'folder', parent: 'f2', owner: 'Neha Kulkarni', modified: '8h ago', minutesAgo: 480, shared: true },
  { id: 'd3', name: 'Component audit', kind: 'sheet', parent: 'f2', owner: 'Neha Kulkarni', modified: '2d ago', minutesAgo: 2900, bytes: 168_000, shared: true },
  { id: 'd4', name: 'Icon set.pdf', kind: 'pdf', parent: 'f2', owner: 'Neha Kulkarni', modified: '5d ago', minutesAgo: 7300, bytes: 3_400_000, shared: true },

  // Design / Brand
  { id: 'b1', name: 'Logo guidelines.pdf', kind: 'pdf', parent: 'd1', owner: 'Neha Kulkarni', modified: '3d ago', minutesAgo: 4500, bytes: 5_100_000, shared: true },
  { id: 'b2', name: 'Colour tokens', kind: 'sheet', parent: 'd1', owner: 'Arohi Mittal', modified: '1w ago', minutesAgo: 10080, bytes: 96_700, starred: true },

  // Design / Mockups
  { id: 'm1', name: 'Shell mockups', kind: 'slides', parent: 'd2', owner: 'Neha Kulkarni', modified: '8h ago', minutesAgo: 480, bytes: 14_200_000, shared: true, starred: true },
  { id: 'm2', name: 'Mobile mockups', kind: 'slides', parent: 'd2', owner: 'Neha Kulkarni', modified: '2d ago', minutesAgo: 3200, bytes: 9_800_000, shared: true },
  { id: 'm3', name: 'Dark mode mockups', kind: 'slides', parent: 'd2', owner: 'Arohi Mittal', modified: '4d ago', minutesAgo: 5900, bytes: 7_300_000 },

  // Operations
  { id: 'o1', name: 'HR', kind: 'folder', parent: 'f13', owner: 'Priya Nair', modified: '2d ago', minutesAgo: 3300, shared: true },
  // Deliberately empty, so the empty state is reachable by clicking.
  { id: 'o2', name: 'Archive', kind: 'folder', parent: 'f13', owner: 'Priya Nair', modified: '1mo ago', minutesAgo: 43200 },
  { id: 'o3', name: 'Vendor list', kind: 'sheet', parent: 'f13', owner: 'Priya Nair', modified: '4d ago', minutesAgo: 5760, bytes: 122_000, shared: true },
  { id: 'o4', name: 'Office lease.pdf', kind: 'pdf', parent: 'f13', owner: 'Rushabh Mehta', modified: '2w ago', minutesAgo: 20200, bytes: 2_050_000 },

  // Operations / HR
  { id: 'h1', name: 'Hiring plan', kind: 'writer', parent: 'o1', owner: 'Priya Nair', modified: '2d ago', minutesAgo: 3300, bytes: 44_800, shared: true },
  { id: 'h2', name: 'Interview rubric', kind: 'writer', parent: 'o1', owner: 'Aditya Verma', modified: '1w ago', minutesAgo: 10100, bytes: 39_200, shared: true },

  // Trash spans the tree, so it is a view rather than a place.
  { id: 't1f', name: 'Archive 2025', kind: 'folder', parent: null, owner: 'Arohi Mittal', modified: '2w ago', minutesAgo: 20160, trashed: true },
  { id: 't2f', name: 'Old roadmap', kind: 'writer', parent: 'p1', owner: 'Arohi Mittal', modified: '3w ago', minutesAgo: 30240, bytes: 61_500, trashed: true },
]

const PERSONAL_FILES: FileRow[] = [
  // Root
  { id: 'x1', name: 'Finances', kind: 'folder', parent: null, owner: 'Arohi Mittal', modified: '6h ago', minutesAgo: 360 },
  { id: 'x2', name: 'Travel', kind: 'folder', parent: null, owner: 'Arohi Mittal', modified: '4d ago', minutesAgo: 5760 },
  { id: 'x3', name: 'Flat', kind: 'folder', parent: null, owner: 'Arohi Mittal', modified: '2w ago', minutesAgo: 20160 },
  { id: 'x4', name: 'Side project ideas', kind: 'writer', parent: null, owner: 'Arohi Mittal', modified: '45m ago', minutesAgo: 45, bytes: 12_400, starred: true },
  { id: 'x5', name: 'Reading list', kind: 'writer', parent: null, owner: 'Arohi Mittal', modified: '3h ago', minutesAgo: 180, bytes: 18_600, starred: true },
  { id: 'x6', name: 'Rent split', kind: 'sheet', parent: null, owner: 'Aditya Verma', modified: 'yesterday', minutesAgo: 1500, bytes: 26_800, shared: true },
  { id: 'x7', name: 'Health records.pdf', kind: 'pdf', parent: null, owner: 'Arohi Mittal', modified: '2mo ago', minutesAgo: 86400, bytes: 3_120_000 },
  { id: 'x8', name: 'Wedding speech', kind: 'writer', parent: null, owner: 'Arohi Mittal', modified: '5d ago', minutesAgo: 7200, bytes: 21_300, shared: true },

  // Finances
  { id: 'x9', name: 'Monthly budget', kind: 'sheet', parent: 'x1', owner: 'Arohi Mittal', modified: '2h ago', minutesAgo: 120, bytes: 96_400, starred: true },
  { id: 'x10', name: 'Tax return 2025', kind: 'sheet', parent: 'x1', owner: 'Arohi Mittal', modified: '1w ago', minutesAgo: 10080, bytes: 148_000 },
  { id: 'x11', name: 'Insurance policy.pdf', kind: 'pdf', parent: 'x1', owner: 'Arohi Mittal', modified: '3mo ago', minutesAgo: 129600, bytes: 2_460_000 },

  // Travel
  { id: 'x12', name: 'Japan itinerary', kind: 'writer', parent: 'x2', owner: 'Arohi Mittal', modified: '4d ago', minutesAgo: 5760, bytes: 34_700, starred: true },
  { id: 'x13', name: 'Goa trip plan', kind: 'writer', parent: 'x2', owner: 'Priya Nair', modified: '3d ago', minutesAgo: 4320, bytes: 41_000, shared: true },
  { id: 'x14', name: 'Flight bookings.pdf', kind: 'pdf', parent: 'x2', owner: 'Arohi Mittal', modified: '6d ago', minutesAgo: 8640, bytes: 940_000 },
  { id: 'x15', name: 'Packing list', kind: 'sheet', parent: 'x2', owner: 'Arohi Mittal', modified: '4d ago', minutesAgo: 5800, bytes: 8_200 },

  // Flat
  { id: 'x16', name: 'Lease.pdf', kind: 'pdf', parent: 'x3', owner: 'Arohi Mittal', modified: '1mo ago', minutesAgo: 43200, bytes: 1_840_000 },
  { id: 'x17', name: 'Renovation plan', kind: 'slides', parent: 'x3', owner: 'Arohi Mittal', modified: '2w ago', minutesAgo: 20160, bytes: 6_400_000 },
  { id: 'x18', name: 'Utility bills', kind: 'sheet', parent: 'x3', owner: 'Arohi Mittal', modified: '3w ago', minutesAgo: 30240, bytes: 74_500 },

  // Trash
  { id: 'x19', name: 'Old resume', kind: 'writer', parent: null, owner: 'Arohi Mittal', modified: '4mo ago', minutesAgo: 172800, bytes: 44_000, trashed: true },
]

/** Each workspace owns its whole tree, so switching swaps the Files area. */
const WORKSPACE_FILES: Record<WorkspaceId, FileRow[]> = {
  arohi: FRAPPE_FILES,
  // Kept keyed but unlisted: the personal tree is here for the day a second
  // workspace goes back into WORKSPACES.
  personal: PERSONAL_FILES,
}

/** Owner faces, so the Files list reads as real data instead of initials. */
export const PEOPLE: Record<string, string> = {
  'Arohi Mittal': USER.avatar,
  'Neha Kulkarni': 'https://avatars.githubusercontent.com/u/583231?v=4',
  'Priya Nair': 'https://avatars.githubusercontent.com/u/1?v=4',
  'Aditya Verma': 'https://avatars.githubusercontent.com/u/2?v=4',
  'Rushabh Mehta': 'https://avatars.githubusercontent.com/u/4?v=4',
}

export const FOLDERS = [
  { id: 'all', label: 'All files', icon: 'lucide-folder' },
  { id: 'shared', label: 'Shared with me', icon: 'lucide-users' },
  { id: 'starred', label: 'Starred', icon: 'lucide-star' },
  { id: 'trash', label: 'Trash', icon: 'lucide-trash-2' },
]

const BY_ID: Record<WorkspaceId, Map<string, FileRow>> = {
  arohi: new Map(FRAPPE_FILES.map((file) => [file.id, file])),
  personal: new Map(PERSONAL_FILES.map((file) => [file.id, file])),
}

const NO_FILES: FileRow[] = []

/** A workspace made in the switcher carries no tree, so it opens empty. */
function filesOf(workspace: WorkspaceId): FileRow[] {
  return WORKSPACE_FILES[workspace] ?? NO_FILES
}

/** Rows inside one folder. `null` is the root. Trashed rows live only in Trash. */
export function childrenOf(parentId: string | null, workspace: WorkspaceId): FileRow[] {
  return filesOf(workspace).filter((file) => file.parent === parentId && !file.trashed)
}

export function filesInView(viewId: string, workspace: WorkspaceId): FileRow[] {
  const files = filesOf(workspace)
  if (viewId === 'trash') return files.filter((file) => file.trashed)
  const live = files.filter((file) => !file.trashed)
  if (viewId === 'shared') return live.filter((file) => file.shared)
  if (viewId === 'starred') return live.filter((file) => file.starred)
  return childrenOf(null, workspace)
}

export function pathTo(id: string, workspace: WorkspaceId): FileRow[] {
  const byId = BY_ID[workspace]
  if (!byId) return []
  const chain: FileRow[] = []
  let current = byId.get(id)
  while (current) {
    chain.unshift(current)
    current = current.parent ? byId.get(current.parent) : undefined
  }
  return chain
}

export function rowForDoc(ref: DocRef): FileRow | RecentDoc | undefined {
  const matches = (row: FileRow | RecentDoc) =>
    ref.app === 'pdf'
      ? row.kind === 'pdf' && row.name === ref.id
      : row.doc?.id === ref.id && row.doc.app === ref.app

  for (const files of Object.values(WORKSPACE_FILES)) {
    const hit = files.find(matches)
    if (hit) return hit
  }
  return RECENT_DOCS.find(matches)
}

export interface MeetingRoom {
  id: string
  name: string
  handle: string
  cadence: string
  code: string
}

export const MEETING_ROOMS: MeetingRoom[] = [
  { id: 'm1', name: 'Frappe Suite standup', handle: 'frappe-suite', cadence: 'Weekdays, 09:30', code: REAL_MEETS.standup },
  { id: 'm2', name: 'Timeless weekly', handle: 'timeless', cadence: 'Thursdays, 16:00', code: REAL_MEETS.timeless },
  { id: 'm3', name: 'Design review', handle: 'design', cadence: 'Tuesdays, 15:00', code: REAL_MEETS.designReview },
  { id: 'm4', name: 'Arohi Mittal', handle: 'arohi', cadence: '', code: REAL_MEETS.arohi },
]

export const CALENDARS = [
  { id: 'work', label: 'Work', dot: 'bg-surface-blue-5' },
  { id: 'personal', label: 'Personal', dot: 'bg-surface-green-5' },
]

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
