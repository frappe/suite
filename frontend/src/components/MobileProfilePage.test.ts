import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import MailProfile from '@/apps/mail/pages/ProfileView.vue'

import MobileProfilePage from './MobileProfilePage.vue'

const mail = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    accounts: ref<{ id: string; _name: string }[]>([]),
    unifiedFolders: ref<{ slug: string; unread_threads: number; unread_by_account: object }[]>([]),
    switchAccount: vi.fn(),
    switchToAll: vi.fn(),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'one',
    unifiedFolders: {
      get data() {
        return mail.unifiedFolders.value
      },
    },
    userResource: {
      data: {
        get accounts() {
          return mail.accounts.value
        },
      },
    },
  }),
}))
vi.mock('@/apps/mail/stores/session', () => ({
  sessionStore: () => ({ logout: { submit: vi.fn() } }),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useAccountSwitch: () => ({ switchAccount: mail.switchAccount, switchToAll: mail.switchToAll }),
}))
vi.mock('@/apps/mail/utils/unifiedFolders', () => ({ prefersUnified: () => true }))

vi.mock('@/platform/pwa', () => ({
  useDevicePush: () => ({ available: ref(false) }),
}))
vi.mock('@/platform/feedback', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/shell/settings/useSettingsDialog', () => ({
  openSettingsPage: vi.fn(),
  useSettingsGroups: () => ({ groups: ref([]), refresh: vi.fn() }),
}))

// The accounts sheet, drawn in place while it is open.
vi.mock('frappe-ui', async (original) => {
  const { defineComponent, h } = await import('vue')
  return {
    ...(await original<object>()),
    BottomSheet: defineComponent({
      props: { open: Boolean },
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h('div', { 'data-sheet': '' }, slots.default?.()) : null,
    }),
  }
})

let cleanup: (() => void) | undefined
// A button by the name it shows, within `scope`: the page, or the open accounts sheet.
const buttonIn = (scope: ParentNode | null | undefined, label: string) =>
  [...(scope?.querySelectorAll('button') ?? [])].find((item) =>
    [...item.querySelectorAll('span')].some((span) => span.textContent?.trim() === label),
  )
const sheet = () => document.querySelector('[data-sheet]')
afterEach(() => cleanup?.())

for (const appName of ['mail', 'calendar']) {
  describe(`${appName} account choices`, () => {
    it('offers switching only after a second real account becomes available', async () => {
      mail.accounts.value = []
      mail.switchAccount.mockClear()
      mail.switchToAll.mockClear()
      const accounts = appName === 'mail' ? mail.accounts : ref<{ id: string; _name: string }[]>([])
      const switchAccount = appName === 'mail' ? mail.switchAccount : vi.fn()
      const switchToAll = appName === 'mail' ? mail.switchToAll : vi.fn()
      const root = document.createElement('div')
      document.body.appendChild(root)
      const app = createApp({
        setup: () => () =>
          appName === 'mail'
            ? h(MailProfile)
            : h(MobileProfilePage, {
                accounts: accounts.value,
                accountId: 'one',
                app: appName,
                allAccounts: appName === 'mail' ? { active: true } : undefined,
                logout: { submit: vi.fn() },
                onSwitchAccount: switchAccount,
                onSwitchToAll: switchToAll,
              }),
      })
      app.config.globalProperties.__ = (text: string) => text
      app.provide('$user', { data: { full_name: 'Reader', name: 'reader@example.com' } })
      app.mount(root)
      cleanup = () => {
        app.unmount()
        root.remove()
      }
      // The page's one Switch account row, which opens the sheet.
      const row = () => buttonIn(root, 'Switch account')

      // Empty while loading, then a loaded account: neither state offers a choice.
      expect(row()).toBeUndefined()
      accounts.value = [{ id: 'one', _name: 'First account' }]
      await nextTick()
      expect(row()).toBeUndefined()
      expect(root.textContent).toContain('Reader')

      accounts.value.push({ id: 'two', _name: 'Second account' })
      await nextTick()
      // Named for the account in use: every account at once, as Mail is mocked to prefer.
      expect(row()?.textContent).toContain(appName === 'mail' ? 'All accounts' : 'First account')
      row()!.click()
      await nextTick()
      expect(buttonIn(sheet(), 'First account')).toBeDefined()
      buttonIn(sheet(), 'Second account')!.click()
      expect(switchAccount).toHaveBeenCalledWith('two')
      // The sheet goes as the switch is made.
      await nextTick()
      expect(sheet()).toBeNull()
      row()!.click()
      await nextTick()
      if (appName === 'mail') {
        buttonIn(sheet(), 'All accounts')!.click()
        expect(switchToAll).toHaveBeenCalledOnce()
      } else {
        expect(buttonIn(sheet(), 'All accounts')).toBeUndefined()
      }

      accounts.value = accounts.value.slice(0, 1)
      await nextTick()
      expect(row()).toBeUndefined()
    })
  })
}

// The accounts the reader is not in say what is unread there, as the sidebar's account menu does:
// that is what tells them to switch.
describe('mail account unread counts', () => {
  const mountProfile = () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp({ setup: () => () => h(MailProfile) })
    app.config.globalProperties.__ = (text: string) => text
    app.provide('$user', { data: { full_name: 'Reader', name: 'reader@example.com' } })
    app.mount(root)
    cleanup = () => {
      app.unmount()
      root.remove()
    }
    // What a row of the accounts sheet ends with, after its name.
    return (label: string) => {
      const parts = [...(sheet()?.querySelectorAll('button') ?? [])].flatMap((item) => [
        ...item.children,
      ])
      const name = parts.findIndex((part) => part.textContent?.trim() === label)
      const rest = [...(parts[name]?.parentElement?.children ?? [])]
      return rest
        .slice(rest.indexOf(parts[name]!) + 1)
        .map((part) => part.textContent?.replace(/\s+/g, ' ').trim())
        .join('')
    }
  }

  it("shows each account's unread mail, and stops a count at 99+", async () => {
    mail.accounts.value = [
      { id: 'one', _name: 'First account' },
      { id: 'two', _name: 'Second account' },
      { id: 'three', _name: 'Third account' },
    ]
    mail.unifiedFolders.value = [
      { slug: 'sent', unread_threads: 7, unread_by_account: { one: 7 } },
      { slug: 'inbox', unread_threads: 203, unread_by_account: { one: 3, two: 200, three: 0 } },
    ]
    // prefersUnified is mocked on, so All accounts is what is in use: its row has no count.
    const row = mountProfile()
    await nextTick()
    buttonIn(document.body, 'All accounts')!.click()
    await nextTick()
    expect(row('First account')).toBe('3 unread')
    expect(row('Second account')).toBe('99+ unread')
    expect(row('Third account')).toBe('')
    expect(row('All accounts')).toBe('')
  })
})
