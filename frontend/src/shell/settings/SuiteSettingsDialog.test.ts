import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, inject, nextTick, provide, ref, type Ref } from 'vue'

import { settingsSection } from '@/platform/settings'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import { requireTestElement } from '@/platform/testing/dom'
import { SETTINGS_GROUPS_KEY, type SettingsGroup } from '@/shell/settings/settings'

import SuiteSettingsDialog from './SuiteSettingsDialog.vue'

vi.mock('vue-router', () => ({ useRoute: () => ({ meta: {} }) }))
vi.mock('@/shell/useIsMobile', () => ({ isMobile: false }))
vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('@/platform/session', async () => {
  const { ref: sessionRef } = await import('vue')
  return {
    useSession: () => ({ status: sessionRef('ready'), user: sessionRef({ fullName: 'Maya' }) }),
  }
})
// The parts this file doesn't open
vi.mock('@/shell/settings/SettingsDrillIn.vue', () => ({ default: { render: () => null } }))
vi.mock('frappe-ui', () => {
  function slotIn(tag: string) {
    return defineComponent({
      setup(_, { slots }) {
        return () => h(tag, slots.default?.())
      },
    })
  }

  const Dialog = defineComponent({
    props: { open: Boolean, title: { type: String, default: '' } },
    setup(props) {
      return () => {
        if (!props.open) {
          return null
        }

        return h('dialog', { 'aria-label': props.title })
      }
    },
  })
  return {
    Avatar: { render: () => null },
    Button: { render: () => null },
    Dialog: Object.assign(Dialog, { Close: { render: () => null } }),
    LoadingIndicator: { render: () => null },
    SettingsRow: { render: () => null },
    // The tabs as reka wires them: a trigger picks its tab, and only the picked tab's panel shows
    SettingsDialog: defineComponent({
      props: { open: Boolean, tab: { type: String, default: '' } },
      emits: ['update:tab'],
      setup(props, { emit, slots }) {
        provide('tab', () => props.tab)
        provide('pickTab', (tab: string) => emit('update:tab', tab))
        return () => {
          if (!props.open) {
            return null
          }

          return h('div', { role: 'dialog', 'data-tab': props.tab }, slots.default?.())
        }
      },
    }),
    SettingsSidebar: slotIn('nav'),
    SettingsContent: slotIn('main'),
    SettingsPanel: defineComponent({
      props: { value: { type: String, required: true } },
      setup(props, { slots }) {
        const tab = inject<() => string>('tab')
        return () => {
          if (tab?.() !== props.value) {
            return null
          }

          return slots.default?.()
        }
      },
    }),
    SettingsNavGroup: defineComponent({
      props: { label: { type: String, default: '' } },
      setup(props, { slots }) {
        return () => h('section', [h('h2', props.label), slots.default?.()])
      },
    }),
    SettingsNavItem: defineComponent({
      props: { value: { type: String, required: true } },
      setup(props, { slots }) {
        const pickTab = inject<(tab: string) => void>('pickTab')
        return () =>
          h('button', { role: 'tab', onClick: () => pickTab?.(props.value) }, slots.default?.())
      },
    }),
    TextInput: defineComponent({
      props: { modelValue: { type: String, default: '' } },
      emits: ['update:modelValue'],
      setup(props, { emit, expose }) {
        const input = ref<HTMLInputElement>()
        expose({ focus: () => input.value?.focus() })
        return () =>
          h('input', {
            ref: input,
            value: props.modelValue,
            onInput: (event: Event) =>
              emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
          })
      },
    }),
  }
})

// Whether the site gives mail servers: Mail client setup shows only then
const hasServers: Ref<boolean> = ref(true)
/** Mail's Import and export page, as far as its Import row. */
const ImportExportPage = defineComponent({
  setup() {
    return () =>
      h(SettingsDialogRow, {
        title: 'Import',
        action: 'Import',
        section: 'mail.import-export.import',
      })
  },
})
/** Mail's Advanced page, as far as its Mail client setup row. */
const AdvancedPage = defineComponent({
  setup() {
    return () =>
      hasServers.value &&
      h(SettingsDialogRow, {
        title: 'Mail client setup',
        action: 'Show',
        section: 'mail.advanced.client-setup',
      })
  },
})

function body() {
  return Promise.resolve({ render: () => null })
}

const account: SettingsGroup = {
  label: () => 'Account',
  tabs: [{ id: 'account.profile', label: () => 'Profile', icon: '', body }],
}
const mail: SettingsGroup = {
  label: () => 'Mail',
  tabs: [
    {
      id: 'mail.sending',
      label: () => 'Sending',
      icon: '',
      body,
      sections: [{ id: 'auto-reply', label: () => 'Auto-reply', keywords: () => 'vacation' }],
    },
    {
      id: 'mail.import-export',
      label: () => 'Import and export',
      icon: '',
      body: () => Promise.resolve(ImportExportPage),
      sections: [
        { id: 'import', label: () => 'Import' },
        { id: 'export', label: () => 'Export' },
      ],
    },
    {
      id: 'mail.advanced',
      label: () => 'Advanced',
      icon: '',
      body: () => Promise.resolve(AdvancedPage),
      sections: [{ id: 'client-setup', label: () => 'Mail client setup', keywords: () => 'IMAP' }],
    },
  ],
}

// A group whose condition reads the session, and so recomputes when the session refreshes
const hasCalendar: Ref<boolean> = ref(false)
const calendar: SettingsGroup = {
  label: () => 'Calendar',
  condition: () => hasCalendar.value,
  tabs: [{ id: 'calendar.general', label: () => 'General', icon: '', body }],
}

const isOpen = ref(true)
let app: ReturnType<typeof createApp>
let root: HTMLElement
async function mount() {
  root = document.createElement('div')
  app = createApp({ render: () => h(SuiteSettingsDialog, { open: isOpen.value }) })
  app.config.globalProperties.__ = (text: string) => text
  app.provide(SETTINGS_GROUPS_KEY, [account, mail, calendar])
  // On the page, so its parts can take focus
  document.body.append(root)
  app.mount(root)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** A sidebar row as it reads: a tab, or a section found under one as a button. */
function row(item: Element) {
  const kind = item.getAttribute('role') ?? item.tagName.toLowerCase()
  const text = item.textContent.trim()
  return `${kind} ${text}`
}

function sidebar() {
  return Array.from(root.querySelectorAll('nav button, nav p')).map(row)
}

function searchBox() {
  return requireTestElement(root.querySelector('nav input'), HTMLInputElement)
}

async function search(text: string) {
  searchBox().value = text
  searchBox().dispatchEvent(new Event('input'))
  await nextTick()
}

/** The tab the dialog shows. */
function shownTab() {
  return root.querySelector('[role="dialog"]')?.getAttribute('data-tab')
}

/** Picks the tab or found section that reads `text` in the sidebar, and lets its page load. */
async function pick(text: string) {
  const item = Array.from(root.querySelectorAll('nav button')).find(
    (entry) => entry.textContent.trim() === text,
  )
  requireTestElement(item, HTMLElement).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The titles of the dialogs open on the page. */
function openDialogs() {
  return Array.from(root.querySelectorAll('main dialog')).map((dialog) =>
    dialog.getAttribute('aria-label'),
  )
}

beforeEach(() => {
  isOpen.value = true
  hasServers.value = true
  hasCalendar.value = false
  settingsSection.value = undefined
})
afterEach(() => {
  app.unmount()
  root.remove()
})

it('lists every tab, and no section, until something is searched for', async () => {
  await mount()
  expect(sidebar()).toEqual(['tab Profile', 'tab Sending', 'tab Import and export', 'tab Advanced'])
})
it('shows a section found by another word for it, and opens it when picked', async () => {
  await mount()
  await search('vacation')
  expect(sidebar()).toEqual(['tab Sending', 'button Auto-reply'])
  await pick('Auto-reply')
  expect(shownTab()).toBe('mail.sending')
  expect(settingsSection.value).toBe('mail.sending.auto-reply')
})
it('opens the first section found when Enter is pressed', async () => {
  await mount()
  await search('port')
  expect(sidebar()).toEqual(['tab Import and export', 'button Import', 'button Export'])
  expect(openDialogs()).toEqual([])
  searchBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(shownTab()).toBe('mail.import-export')
  expect(openDialogs()).toEqual(['Import'])
})
it('walks from the search box down the tabs and found sections, and back, on the arrow keys', async () => {
  await mount()
  await search('port')
  searchBox().focus()
  const walked = ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp'].map((key) => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    return row(requireTestElement(document.activeElement, HTMLElement))
  })
  // The fourth press is past the last row
  expect(walked).toEqual([
    'tab Import and export',
    'button Import',
    'button Export',
    'button Export',
    'button Import',
  ])

  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowUp']) {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }

  expect(document.activeElement).toBe(searchBox())
})
it('opens the dialog of a found section on its page, from another tab', async () => {
  await mount()
  await search('imap')
  await pick('Mail client setup')
  expect(shownTab()).toBe('mail.advanced')
  expect(openDialogs()).toEqual(['Mail client setup'])
})
it('opens a section that shows late, while its tab is still the one showing', async () => {
  hasServers.value = false
  await mount()
  await search('imap')
  await pick('Mail client setup')
  expect(openDialogs()).toEqual([])
  hasServers.value = true
  await nextTick()
  expect(openDialogs()).toEqual(['Mail client setup'])
})
it('forgets a section that never showed once its tab is left', async () => {
  hasServers.value = false
  await mount()
  await search('imap')
  await pick('Mail client setup')
  await search('')
  await pick('Sending')
  hasServers.value = true
  await pick('Advanced')
  expect(shownTab()).toBe('mail.advanced')
  expect(openDialogs()).toEqual([])
})
it('opens a tab found by its own name on Enter, asking for no section', async () => {
  await mount()
  await search('mail adv')
  searchBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  await nextTick()
  expect(shownTab()).toBe('mail.advanced')
  expect(settingsSection.value).toBeUndefined()
})
it('stays on its tab when Enter is pressed with nothing searched for', async () => {
  await mount()
  await search('mail adv')
  searchBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  await search('')
  searchBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  await nextTick()
  expect(shownTab()).toBe('mail.advanced')
})
it('says so when nothing is found', async () => {
  await mount()
  await search('zebra')
  expect(sidebar()).toEqual(['p No settings match your search.'])
})
it('starts the next open with nothing searched for', async () => {
  await mount()
  await search('vacation')
  isOpen.value = false
  await nextTick()
  isOpen.value = true
  await nextTick()
  expect(searchBox().value).toBe('')
  expect(sidebar()).toEqual(['tab Profile', 'tab Sending', 'tab Import and export', 'tab Advanced'])
})
it('stays on the tab picked when a group shows or goes while it is open', async () => {
  await mount()
  await pick('Sending')
  hasCalendar.value = true
  await nextTick()
  expect(shownTab()).toBe('mail.sending')
})
