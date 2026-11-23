import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailListItem from '@/apps/mail/components/MailListItem.vue'
import type { Thread } from '@/apps/mail/types'
import { translationPlugin } from '@/platform/translation'

// The real Popover and Tooltip, so a click on the "+N" chip goes through the same trigger as in the app.
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
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Popover')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Tooltip')),
    Avatar: passthrough(),
    Badge: passthrough(),
  }
})
vi.mock('@/api', () => ({ api: { mail: { messages: {} } }, client: { mutation: vi.fn() } }))
vi.mock('@/apps/mail/components/AttachmentCapsule.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: { fileName: { type: String, default: '' } },
      setup: (props) => () => h('span', { 'data-capsule': '' }, props.fileName),
    }),
  }
})
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

const files = ['agenda.pdf', 'budget.xlsx', 'floor-plan.png']

const mounted: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

const mountRow = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  const mail = fromPartial<Thread>({
    thread_id: 't1',
    seen: 1,
    mailboxes: [],
    attachments: files.map((filename, i) =>
      fromPartial({
        filename,
        blob_id: `b${i}`,
        type: 'application/pdf',
        disposition: 'attachment',
      }),
    ),
    received_at: '2026-11-06T10:00:00Z',
    messages: [
      fromPartial({ from_name: 'Dana Scully', from_email: 'dana@example.com', mailboxes: [] }),
    ],
    from_name: 'Dana Scully',
    from_email: 'dana@example.com',
  })
  const el = document.createElement('div')
  document.body.append(el)
  const app = createApp(MailListItem, { mail, mailbox: 'in', isSelected: false })
  app.use(router).use(translationPlugin)
  app.provide('$user', { data: { show_reading_pane: false } })
  app.mount(el)
  mounted.push(app)
  await router.isReady()
  return { router, el }
}

describe('the "+N" attachments chip in a row', () => {
  it('lists the attachments not shown in the row, and stays on the list', async () => {
    const { router, el } = await mountRow()
    const more = [...el.querySelectorAll('[data-capsule]')].find((c) => c.textContent === '+1')
    expect(more).toBeTruthy()

    more!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))

    await vi.waitFor(() => expect(document.body.textContent).toContain('floor-plan.png'))
    await nextTick()
    expect(router.currentRoute.value.fullPath).toBe('/')
  })
})
