import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import MailActions from '@/apps/mail/components/MailActions.vue'
import type { Mail } from '@/apps/mail/types'

// The menu as it is handed every option, whether or not it would show for this message.
vi.mock('@/platform/feedback', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Dropdown: defineComponent({
      props: { options: { type: Array, default: () => [] } },
      setup: (props) => () =>
        h(
          'ul',
          { 'data-menu': '' },
          props.options.flatMap((group) =>
            // SAFETY: MailActions hands the menu only groups, each with its options.
            (group as { options: { label: string }[] }).options.map((option) =>
              h('li', option.label),
            ),
          ),
        ),
    }),
  }
})
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Button: defineComponent({ setup: () => () => h('button') }),
    BottomSheet: defineComponent({ setup: () => () => null }),
    toast: {},
  }
})
vi.mock('vue-router', () => ({ useRoute: () => ({}), useRouter: () => ({}) }))
vi.mock('@/api', () => ({ api: {}, client: {} }))
vi.mock('@/apps/mail/utils', () => ({ matchesScreenedValue: () => false }))
vi.mock('@/apps/mail/utils/unifiedFolders', () => ({}))
vi.mock('@/apps/mail/composables/useScreener', () => ({ useScreener: () => ({}) }))
vi.mock('@/apps/mail/utils/accountScope', () => ({
  injectAccountScope: () => ({
    accountId: ref('acc'),
    mailboxIds: ref({ trash: 'tr', drafts: 'dr', sent: 'se' }),
    identities: ref({ data: [] }),
    screenedAddresses: ref({ data: [] }),
  }),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: ref(false) }),
  useUndo: () => ({ setUndoAction: () => {}, undo: () => {} }),
  useFilterBySender: () => ({ filterBySender: () => {} }),
}))

const menu = () => {
  const el = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MailActions, {
        mailbox: 'in',
        mail: fromPartial<Mail>({ name: 'm1', draft: 0, flagged: 0, junk: 0, mailboxes: [] }),
        isCollapsed: false,
        showReplyAll: false,
        popOutDraft: () => {},
        reply: () => {},
        replyAll: () => {},
        forward: () => {},
        reloadMails: () => {},
        dropMail: () => () => {},
        thread: [],
      }),
  })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(el)
  const labels = [...el.querySelectorAll('[data-menu] li')].map((item) => item.textContent)
  app.unmount()
  return labels
}

describe("a message's menu", () => {
  it('offers no event: an event is made from a date in the message instead', () => {
    const labels = menu()
    expect(labels).toContain('Download Email')
    expect(labels.filter((label) => /event/i.test(label ?? ''))).toEqual([])
  })
})
