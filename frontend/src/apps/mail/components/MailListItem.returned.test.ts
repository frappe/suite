import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailListItem from '@/apps/mail/components/MailListItem.vue'
import type { Thread } from '@/apps/mail/types'

const mutation = vi.hoisted(() => vi.fn())

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
    Avatar: passthrough(),
    Badge: passthrough(),
    Checkbox: passthrough(),
    Popover: passthrough(),
    Tooltip: passthrough(),
  }
})
vi.mock('@/api', () => ({
  api: { mail: { messages: { dismissReturned: 'dismissReturned' } } },
  client: { mutation },
}))
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
  raiseOptimisticToast: () => undefined,
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useOwnEmails: () => ref([]),
  useScreenSize: () => ({ isMobile: ref(true) }),
}))
vi.mock('@/apps/mail/utils/unifiedFolders', () => ({ threadLink: () => '/thread' }))

const REMOVE = '[aria-label="Remove from Reminders"]'

const mounted: ReturnType<typeof createApp>[] = []

const row = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/thread', component: { render: () => null } },
    ],
  })
  await router.push('/')
  const el = document.createElement('div')
  const mail = fromPartial<Thread>({
    thread_id: 't1',
    returned: 1,
    no_reply: 1,
    seen: 1,
    mailboxes: [],
    attachments: [],
    messages: [],
    received_at: '2026-11-06T10:00:00Z',
  })
  const app = createApp(MailListItem, { mail, mailbox: 'in', accountId: 'a1', isSelected: false })
  app.use(router)
  app.provide('$user', { data: { show_reading_pane: true } })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(el)
  mounted.push(app)

  const click = async (selector: string) => {
    el.querySelector(selector)!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    )
    await new Promise((resolve) => setTimeout(resolve))
  }
  return { click, path: () => router.currentRoute.value.path }
}

beforeEach(() => {
  mutation.mockReset()
  mutation.mockResolvedValue({ ids: ['t1'], no_reply_ids: ['t1'] })
})
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
})

describe("a returned row's badge", () => {
  it('takes the mark off when its × is clicked, without opening the thread', async () => {
    const { click, path } = await row()

    await click(REMOVE)

    expect(mutation).toHaveBeenCalledWith('dismissReturned', {
      account: 'a1',
      thread_ids: ['t1'],
    })
    expect(path()).toBe('/')
  })

  it('leaves the mark and opens the thread when the row is clicked', async () => {
    const { click, path } = await row()

    await click('h3')

    expect(mutation).not.toHaveBeenCalled()
    expect(path()).toBe('/thread')
  })
})
