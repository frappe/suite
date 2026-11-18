import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref, type App } from 'vue'

import MailActions from '@/apps/mail/components/MailActions.vue'
import type { BodyView, Mail } from '@/apps/mail/types'

// Every label the menu is handed, whether or not it would show for this message.
const handed = vi.hoisted(() => new Array<string>())

// The menu, drawn as one button per item it would show: a Dropdown leaves out an item whose
// condition says no.
vi.mock('@/platform/feedback', async () => {
  const { h } = await import('vue')
  interface Option {
    label: string
    onClick: () => void
    condition?: () => boolean
  }
  return {
    Dropdown: ({ options }: { options: { options: Option[] }[] }) =>
      h(
        'menu',
        options
          .flatMap((group) => group.options)
          .filter((option) => {
            handed.push(option.label)
            return option.condition?.() !== false
          })
          .map((option) => h('button', { onClick: option.onClick }, option.label)),
      ),
  }
})
vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  return { Button: defineComponent({ setup: () => () => null }), toast: {} }
})
vi.mock('@/apps/mail/utils/unifiedFolders', () => ({}))
vi.mock('vue-router', () => ({ useRoute: () => ({}), useRouter: () => ({}) }))
vi.mock('@/api', () => ({ api: {}, client: {} }))
vi.mock('@/apps/mail/composables/useScreener', () => ({ useScreener: () => ({}) }))
vi.mock('@/apps/mail/utils', () => ({ matchesScreenedValue: () => false }))
vi.mock('@/apps/mail/utils/accountScope', () => ({
  injectAccountScope: () => ({
    accountId: ref('alice@example.com'),
    mailboxIds: ref({ inbox: 'in', trash: 'tr', sent: 'se', drafts: 'dr' }),
    identities: ref({ data: [] }),
    screenedAddresses: ref({ data: [] }),
  }),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: ref(false) }),
  useUndo: () => ({}),
  useFilterBySender: () => ({}),
}))
vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))

const mail = fromPartial<Mail>({
  name: 'm1',
  id: 'm1',
  draft: 0,
  flagged: 0,
  junk: 0,
  from_email: 'bob@example.com',
  mailboxes: [{ mailbox_id: 'in' }],
})

let app: App | undefined
afterEach(() => {
  app?.unmount()
  handed.length = 0
})

const menuFor = (bodyView?: BodyView) => {
  const onToggleAsSent = vi.fn()
  const root = document.createElement('div')
  app = createApp({
    render: () =>
      h(MailActions, {
        mailbox: 'in',
        mail,
        isCollapsed: false,
        showReplyAll: false,
        popOutDraft: () => {},
        reply: () => {},
        replyAll: () => {},
        forward: () => {},
        reloadMails: () => {},
        dropMail: () => () => {},
        thread: [mail],
        bodyView,
        onToggleAsSent,
      }),
  })
  app.provide('$user', { data: {} })
  app.mount(root)
  const item = (label: string) =>
    [...root.querySelectorAll('button')].find((button) => button.textContent === label)
  return { item, onToggleAsSent }
}

describe("a message's More menu in the dark theme", () => {
  it('offers nothing about colours for a message that is shown as authored', () => {
    const { item } = menuFor(undefined)
    expect(item('Show as Sent')).toBeUndefined()
    expect(item('Show in Dark Theme')).toBeUndefined()
  })

  it('offers to show a recoloured message as sent', () => {
    const { item, onToggleAsSent } = menuFor('adapted')
    expect(item('Show in Dark Theme')).toBeUndefined()
    item('Show as Sent')!.click()
    expect(onToggleAsSent).toHaveBeenCalledOnce()
  })

  it('offers to go back to the dark theme once the message is shown as sent', () => {
    const { item, onToggleAsSent } = menuFor('asSent')
    expect(item('Show as Sent')).toBeUndefined()
    item('Show in Dark Theme')!.click()
    expect(onToggleAsSent).toHaveBeenCalledOnce()
  })
})

describe("a message's menu", () => {
  it('offers no event: an event is made from a date in the message instead', () => {
    const { item } = menuFor(undefined)
    expect(item('Download Email')).toBeDefined()
    expect(handed.filter((label) => /event/i.test(label))).toEqual([])
  })
})
