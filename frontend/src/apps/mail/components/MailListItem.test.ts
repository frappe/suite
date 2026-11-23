import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref, type Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailListItem from '@/apps/mail/components/MailListItem.vue'
import StackListItem from '@/apps/mail/components/StackListItem.vue'
import type { Thread } from '@/apps/mail/types'
import { translationPlugin } from '@/platform/translation'

// The real Checkbox, so the name is read off the box a screen reader lands on.
vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  const passthrough = () =>
    defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    })
  return {
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Checkbox')),
    Avatar: passthrough(),
    Badge: passthrough(),
    Popover: passthrough(),
    Tooltip: passthrough(),
  }
})
vi.mock('@/api', () => ({ api: { mail: { messages: {} } }, client: { mutation: vi.fn() } }))
vi.mock('@/apps/mail/components/AttachmentCapsule.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/components/AttachmentViewer.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/components/MailDate.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/components/MailRowActions.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/composables/useScreener', () => ({
  useScreener: () => ({ waitingSenders: () => [] }),
}))
vi.mock('@/apps/mail/resources', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ mailboxes: { data: [] }, mailboxIds: { sent: 'se', drafts: 'dr' } }),
}))
vi.mock('@/apps/mail/utils', () => ({
  downloadUrlAsFile: () => undefined,
  getFileIcon: () => undefined,
  getFormattedRecipients: () => '',
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useOwnEmails: () => ref(new Set(['me@example.com'])),
  useScreenSize: () => ({ isMobile: ref(false) }),
}))
vi.mock('@/apps/mail/utils/unifiedFolders', () => ({ threadLink: () => '/thread' }))

const thread = (id: string, overrides: Partial<Thread> = {}) =>
  fromPartial<Thread>({
    thread_id: id,
    seen: 1,
    mailboxes: [],
    attachments: [],
    received_at: '2026-11-06T10:00:00Z',
    messages: [
      fromPartial({ from_name: 'Dana Scully', from_email: 'dana@example.com', mailboxes: [] }),
    ],
    from_name: 'Dana Scully',
    from_email: 'dana@example.com',
    ...overrides,
  })

const mounted: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
})

const checkboxName = async (component: Component, props: Record<string, unknown>) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  const el = document.createElement('div')
  const app = createApp(component, { isSelected: false, ...props })
  app.use(router).use(translationPlugin)
  app.provide('$user', { data: { show_reading_pane: true } })
  app.mount(el)
  mounted.push(app)
  return el.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')
}

describe("a row's checkbox", () => {
  it('names the sender in full, not their initial', async () => {
    expect(await checkboxName(MailListItem, { mail: thread('t1'), mailbox: 'in' })).toBe(
      'Select mail from Dana Scully',
    )
  })

  // As the merged Sent and Drafts say their rows are outgoing.
  it('names who the mail is going to in Sent', async () => {
    const mail = thread('t1', {
      recipients: [
        fromPartial({ type: 'To', display_name: 'Fox Mulder', email: 'fox@example.com' }),
        fromPartial({ type: 'Cc', display_name: '', email: 'skinner@example.com' }),
      ],
    })
    expect(await checkboxName(MailListItem, { mail, mailbox: 'se', outgoing: true })).toBe(
      'Select mail to Fox Mulder, skinner@example.com',
    )
  })

  it('says so when a draft is going to no one yet', async () => {
    expect(
      await checkboxName(MailListItem, {
        mail: thread('t1', { recipients: [] }),
        mailbox: 'dr',
        outgoing: true,
      }),
    ).toBe('Select mail with no recipients')
  })

  it('on a stack, says how many conversations it selects and whose', async () => {
    const threads = [thread('t1'), thread('t2'), thread('t3')]
    expect(await checkboxName(StackListItem, { threads, expanded: false })).toBe(
      'Select 3 conversations from Dana Scully',
    )
  })
})
