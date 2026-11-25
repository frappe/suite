import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailListItem from '@/apps/mail/components/MailListItem.vue'
import type { ComposeMailData, Mail, Thread } from '@/apps/mail/types'
import { composeName } from '@/apps/mail/utils/composeName'
import { translationPlugin } from '@/platform/translation'

// A Drafts row on a phone, tapped. The compose page is where the tap lands, by what it was handed.
const composed = vi.hoisted(() => ({ drafts: new Array<ComposeMailData | undefined>() }))
vi.mock('@/apps/mail/composables/composeHandoff', () => ({
  openComposePage: (_router: unknown, _account: string, draft?: ComposeMailData) =>
    composed.drafts.push(draft),
}))
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
    toast: {},
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
vi.mock('@/apps/mail/utils/composables', () => ({
  useOwnEmails: () => ref(new Set(['maya@example.com'])),
  useScreenSize: () => ({ isMobile: ref(true) }),
}))
vi.mock('@/apps/mail/utils/unifiedFolders', () => ({ threadLink: () => '/thread' }))

const draft = fromPartial<Mail>({
  name: 'd1',
  id: 'd1',
  draft: 1,
  from_email: 'maya@example.com',
  subject: 'Launch',
  message_id: '<d1@example.com>',
  html_body: '<p>Running late</p>',
  recipients: [{ type: 'To', email: 'dana@example.com', display_name: 'Dana Lee' }],
  attachments: [],
  mailboxes: [],
})
const received = fromPartial<Mail>({ name: 'm1', id: 'm1', from_email: 'dana@example.com' })
const row = (messages: Mail[]) =>
  fromPartial<Thread>({
    ...draft,
    thread_id: 't1',
    seen: 1,
    received_at: '2026-11-06T10:00:00Z',
    messages,
  })

const mounted: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  composed.drafts = []
})

/** The row in Drafts, tapped. Where the tap went: the compose page's draft, or the route. */
const tap = async (mail: Thread, props: Record<string, unknown> = {}) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push('/drafts')
  const el = document.createElement('div')
  const app = createApp(MailListItem, {
    mail,
    mailbox: 'dr',
    drafts: true,
    isSelected: false,
    ...props,
  })
  app.use(router).use(translationPlugin)
  app.provide('$user', { data: { show_reading_pane: true } })
  app.mount(el)
  mounted.push(app)
  // A tap a moment after the row is up, as a finger's is: Vue drops a click stamped no later than the
  // listener it reaches was attached.
  await new Promise((resolve) => setTimeout(resolve, 5))
  el.querySelector<HTMLElement>('.group')!.click()
  await new Promise((resolve) => setTimeout(resolve))
  return { drafts: composed.drafts, route: () => router.currentRoute.value.path }
}

describe('a Drafts row on a phone', () => {
  it('opens a draft alone in its thread on the compose page, as it was written', async () => {
    const { drafts, route } = await tap(row([draft]))

    expect(route()).toBe('/drafts')
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.id).toBe('d1')
    expect(drafts[0]?.html_body).toContain('Running late')
    expect(drafts[0]?.to?.map((r) => r.email)).toEqual(['dana@example.com'])
    // A new message, not a reply: alone in its thread, it answers nothing.
    expect(composeName(drafts[0])).toBe('New message')
  })

  it('opens the thread of a reply, with the mail it answers', async () => {
    const { drafts, route } = await tap(row([received, draft]))

    expect(drafts).toEqual([])
    await vi.waitFor(() => expect(route()).toBe('/thread'))
  })

  it('only ticks the draft while selecting', async () => {
    const { drafts } = await tap(row([draft]), { selectionMode: true })

    expect(drafts).toEqual([])
  })
})
