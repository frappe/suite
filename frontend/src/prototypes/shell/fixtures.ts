// PROTOTYPE — remove. Fake data for the throwaway workspace-shell prototype.
// Nothing here persists or talks to the backend.

export const WORKSPACE = { name: 'Frappe' }
export const USER = { name: 'Faris', initial: 'F' }

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
  writer: { icon: 'lucide-file-text', tint: 'text-ink-blue-5', label: 'Document' },
  sheet: { icon: 'lucide-table', tint: 'text-ink-green-5', label: 'Spreadsheet' },
  slides: { icon: 'lucide-presentation', tint: 'text-ink-orange-5', label: 'Presentation' },
  pdf: { icon: 'lucide-file', tint: 'text-ink-red-5', label: 'PDF' },
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
}

export const FILES: FileRow[] = [
  { id: 'f1', name: 'Product', kind: 'folder', owner: 'Faris', modified: '2d ago' },
  { id: 'f2', name: 'Design', kind: 'folder', owner: 'Faris', modified: '5d ago' },
  { id: 'f3', name: 'Q3 planning notes', kind: 'writer', owner: 'Faris', modified: '12m ago' },
  { id: 'f4', name: 'Hiring pipeline', kind: 'sheet', owner: 'Faris', modified: '1h ago' },
  { id: 'f5', name: 'Suite launch deck', kind: 'slides', owner: 'Faris', modified: '2h ago' },
  { id: 'f6', name: 'Vendor contract.pdf', kind: 'pdf', owner: 'Faris', modified: '3h ago' },
  { id: 'f7', name: 'Meeting minutes — 14 Aug', kind: 'writer', owner: 'Faris', modified: 'yesterday' },
  { id: 'f8', name: 'Expense tracker', kind: 'sheet', owner: 'Faris', modified: 'yesterday' },
  { id: 'f9', name: 'Design review deck', kind: 'slides', owner: 'Faris', modified: '2d ago' },
  { id: 'f10', name: 'Onboarding checklist', kind: 'writer', owner: 'Faris', modified: '3d ago' },
]

export const FOLDERS = [
  { id: 'all', label: 'All files', icon: 'lucide-folder' },
  { id: 'shared', label: 'Shared with me', icon: 'lucide-users' },
  { id: 'starred', label: 'Starred', icon: 'lucide-star' },
  { id: 'trash', label: 'Trash', icon: 'lucide-trash-2' },
]

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
