import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref, type App } from 'vue'

import MailActions from '@/apps/mail/components/MailActions.vue'
import type { BodyView, Mail } from '@/apps/mail/types'

// Every label the menu is handed, whether or not it would show for this message.
const handed = vi.hoisted(() => new Array<string>())
const screen = vi.hoisted(() => ({ phone: false }))

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
  const { defineComponent, h } = await import('vue')
  // A button beside the star, named as it is to a screen reader.
  return {
    Button: defineComponent({
      inheritAttrs: false,
      setup:
        (_props, { attrs }) =>
        () =>
          h('button', { 'aria-label': attrs['aria-label'] }),
    }),
    toast: {},
  }
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
  useScreenSize: () => ({ isMobile: ref(screen.phone) }),
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
  screen.phone = false
})

const menuFor = (bodyView?: BodyView, thread: Mail[] = [mail]) => {
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
        thread,
        bodyView,
        onToggleAsSent,
      }),
  })
  app.provide('$user', { data: {} })
  app.mount(root)
  const item = (label: string) =>
    [...root.querySelectorAll('button')].find((button) => button.textContent === label)
  const beside = (label: string) => root.querySelector(`button[aria-label="${label}"]`)
  return { item, beside, onToggleAsSent }
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

describe("an open message's Reply beside its star", () => {
  const earlier = fromPartial<Mail>({ ...mail, name: 'm0', id: 'm0' })
  const replyDraft = fromPartial<Mail>({ ...mail, name: 'd1', id: 'd1', draft: 1 })

  it('is left to the reply bar on a phone when the message is the only one, a draft beside it or not', () => {
    screen.phone = true
    const { beside, item } = menuFor(undefined, [mail, replyDraft])
    expect(beside('Reply')).toBeNull()
    expect(item('Reply')).toBeDefined()
  })

  it('stays on a phone in a longer conversation', () => {
    screen.phone = true
    const { beside } = menuFor(undefined, [earlier, mail])
    expect(beside('Reply')).not.toBeNull()
  })

  it('stays on a desktop, which has no reply bar, when the message is alone', () => {
    const { beside } = menuFor(undefined, [mail])
    expect(beside('Reply')).not.toBeNull()
  })
})
