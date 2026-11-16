import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { settingsSection } from '@/platform/settings'
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
vi.mock('@/shell/settings/SettingsTabBody.vue', () => ({ default: { render: () => null } }))
vi.mock('frappe-ui', () => {
  function slotIn(tag: string) {
    return defineComponent({
      setup(_, { slots }) {
        return () => h(tag, slots.default?.())
      },
    })
  }

  return {
    Avatar: { render: () => null },
    Button: { render: () => null },
    Dialog: { Close: { render: () => null } },
    LoadingIndicator: { render: () => null },
    SettingsContent: { render: () => null },
    SettingsPanel: { render: () => null },
    SettingsDialog: defineComponent({
      props: { open: Boolean, tab: { type: String, default: '' } },
      setup(props, { slots }) {
        return () => {
          if (!props.open) {
            return null
          }

          return h('div', { role: 'dialog', 'data-tab': props.tab }, slots.default?.())
        }
      },
    }),
    SettingsSidebar: slotIn('nav'),
    SettingsNavGroup: defineComponent({
      props: { label: { type: String, default: '' } },
      setup(props, { slots }) {
        return () => h('section', [h('h2', props.label), slots.default?.()])
      },
    }),
    SettingsNavItem: slotIn('a'),
    TextInput: defineComponent({
      props: { modelValue: { type: String, default: '' } },
      emits: ['update:modelValue'],
      setup(props, { emit }) {
        return () =>
          h('input', {
            value: props.modelValue,
            onInput: (event: Event) =>
              emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
          })
      },
    }),
  }
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
      id: 'mail.advanced',
      label: () => 'Advanced',
      icon: '',
      body,
      sections: [
        { id: 'import', label: () => 'Import' },
        { id: 'export', label: () => 'Export' },
      ],
    },
  ],
}

const isOpen = ref(true)
let app: ReturnType<typeof createApp>
let root: HTMLElement
async function mount() {
  root = document.createElement('div')
  app = createApp({ render: () => h(SuiteSettingsDialog, { open: isOpen.value }) })
  app.provide(SETTINGS_GROUPS_KEY, [async () => account, async () => mail])
  app.mount(root)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The sidebar as it reads: tabs as links, the sections found under them as buttons. */
function sidebar() {
  return Array.from(root.querySelectorAll('nav a, nav button, nav p')).map((item) => {
    const tag = item.tagName.toLowerCase()
    const text = item.textContent.trim()
    return `${tag} ${text}`
  })
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

beforeEach(() => {
  isOpen.value = true
  settingsSection.value = undefined
})
afterEach(() => app.unmount())

it('lists every tab, and no section, until something is searched for', async () => {
  await mount()
  expect(sidebar()).toEqual(['a Profile', 'a Sending', 'a Advanced'])
})
it('shows a section found by another word for it, and opens it when picked', async () => {
  await mount()
  await search('vacation')
  expect(sidebar()).toEqual(['a Sending', 'button Auto-reply'])
  requireTestElement(root.querySelector('nav button'), HTMLButtonElement).click()
  await nextTick()
  expect(shownTab()).toBe('mail.sending')
  expect(settingsSection.value).toBe('mail.sending.auto-reply')
})
it('opens the first section found when Enter is pressed', async () => {
  await mount()
  await search('port')
  expect(sidebar()).toEqual(['a Advanced', 'button Import', 'button Export'])
  searchBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  await nextTick()
  expect(shownTab()).toBe('mail.advanced')
  expect(settingsSection.value).toBe('mail.advanced.import')
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
  expect(sidebar()).toEqual(['a Profile', 'a Sending', 'a Advanced'])
})
