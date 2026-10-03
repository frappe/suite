// Mail settings: the tabs, and the state each one writes to.
//
// Five tabs, flat. Ordered from who you are to what you let in: the account
// itself, how mail looks, how you write it, how it interrupts you, and what
// it is allowed to load or keep.
import { ref } from 'vue'

export interface SettingsTab {
  id: string
  label: string
  icon: string
  description: string
}

export const SETTINGS_TABS: SettingsTab[] = [
  {
    id: 'account',
    label: 'Account',
    icon: 'lucide-user-round',
    description: 'Your profile, sign-in and storage.',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: 'lucide-layout-dashboard',
    description: 'Density and layout for the message list.',
  },
  {
    id: 'compose',
    label: 'Compose',
    icon: 'lucide-pen-line',
    description: 'Who your mail comes from, and how it goes out.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'lucide-bell',
    description: 'How new mail gets your attention.',
  },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: 'lucide-shield-check',
    description: 'Who reaches you, what mail can load, and what it keeps.',
  },
]

export const settingsTab = ref('appearance')

// ── Account ──────────────────────────────────────────────────────────────
export const firstName = ref('Arohi')
export const lastName = ref('Mittal')
export const username = 'arohi@frappe.io'
export const backupEmail = ref('arohimittal80@gmail.com')

/** Share of the 10 GB plan in use. */
export const storagePercent = 0.36

// ── Compose ──────────────────────────────────────────────────────────────
export const senderName = ref('Arohi Mittal')

export const SENDER_ADDRESSES = [{ label: 'arohi@frappe.io', value: 'arohi@frappe.io' }]
export const senderAddress = ref('arohi@frappe.io')

export const UNDO_SEND_SECONDS = [
  { label: 'Off', value: '0' },
  { label: '5 seconds', value: '5' },
  { label: '10 seconds', value: '10' },
  { label: '30 seconds', value: '30' },
]
export const undoSendSeconds = ref('5')

export const signature = ref('Arohi Mittal\nProduct Designer, Frappe')

// ── Notifications ────────────────────────────────────────────────────────
export const desktopNotifications = ref(true)
export const notificationSound = ref(false)

// ── Privacy ──────────────────────────────────────────────────────────────
export const screenNewSenders = ref(true)
export const loadRemoteImages = ref(false)
export const suspiciousLinkWarnings = ref(true)

export const TRASH_RETENTION = [
  { label: '7 days', value: '7' },
  { label: '15 days', value: '15' },
  { label: '30 days', value: '30' },
  { label: 'Until I delete it', value: 'forever' },
]
export const trashRetention = ref('30')
