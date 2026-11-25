import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailListItem from '@/apps/mail/components/MailListItem.vue'
import type { Thread } from '@/apps/mail/types'
import { translationPlugin } from '@/platform/translation'

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
  userStore: () => ({
    mailboxes: { data: [] },
    mailboxIds: { inbox: 'in', archive: 'ar', trash: 'tr', sent: 'se', drafts: 'dr' },
  }),
}))
vi.mock('@/apps/mail/utils', () => ({
  downloadUrlAsFile: () => undefined,
  getFileIcon: () => undefined,
  getFormattedRecipients: () => '',
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useOwnEmails: () => ref(new Set(['me@example.com'])),
  useScreenSize: () => ({ isMobile: ref(true) }),
}))
vi.mock('@/apps/mail/utils/unifiedFolders', () => ({ threadLink: () => '/thread' }))

// A phone's row: 400px wide, so the swipe's threshold is 120px.
const WIDTH = 400

const thread = (folder: string) => {
  const mailboxes = [{ mailbox_id: folder }]
  return fromPartial<Thread>({
    thread_id: 't1',
    seen: 1,
    mailboxes,
    attachments: [],
    received_at: '2026-11-06T10:00:00Z',
    messages: [fromPartial({ from_name: 'Dana', from_email: 'dana@example.com', mailboxes })],
  })
}

let now = 0
const mounted: ReturnType<typeof createApp>[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(WIDTH)
})
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const mountRow = async (props: Record<string, unknown>) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  const emitted = { archive: vi.fn(), unarchive: vi.fn(), trash: vi.fn(), delete: vi.fn() }
  const el = document.createElement('div')
  const app = createApp(MailListItem, {
    isSelected: false,
    unarchive: true,
    onArchiveThread: emitted.archive,
    onUnarchiveThread: emitted.unarchive,
    onTrashThread: emitted.trash,
    onDeleteThread: emitted.delete,
    ...props,
  })
  app.use(router).use(translationPlugin)
  app.provide('$user', { data: { show_reading_pane: false } })
  app.mount(el)
  mounted.push(app)
  return { row: el.querySelector('a')!, emitted }
}

const touch = (row: Element, type: string, x: number) => {
  const point = { clientX: x, clientY: 200, screenX: x, screenY: 200 }
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    touches: type === 'touchend' ? [] : [point],
    changedTouches: [point],
  })
  row.dispatchEvent(event)
}

/**
 * Drags the row sideways from `from` to `to`, a step every `stepMs`, and lets go: then waits `forMs`,
 * or until the row is done with it.
 */
const drag = async (row: Element, from: number, to: number, stepMs: number, forMs?: number) => {
  now = 0
  touch(row, 'touchstart', from)
  const step = Math.sign(to - from) * 10
  for (let x = from + step; Math.sign(to - x) !== -Math.sign(step); x += step) {
    now += stepMs
    touch(row, 'touchmove', x)
  }
  touch(row, 'touchend', to)
  await (forMs === undefined ? vi.runAllTimersAsync() : vi.advanceTimersByTimeAsync(forMs))
}

describe('swiping a row on a phone', () => {
  it('moves an Inbox row to Trash, dragged left past the threshold', async () => {
    const { row, emitted } = await mountRow({ mail: thread('in'), mailbox: 'in' })
    await drag(row, 300, 140, 50)
    expect(emitted.trash).toHaveBeenCalledOnce()
    expect(emitted.archive).not.toHaveBeenCalled()
  })

  it('does nothing when let go short of the threshold, slowly', async () => {
    const { row, emitted } = await mountRow({ mail: thread('in'), mailbox: 'in' })
    await drag(row, 300, 240, 50)
    await drag(row, 100, 160, 50)
    expect(emitted.trash).not.toHaveBeenCalled()
    expect(emitted.archive).not.toHaveBeenCalled()
  })

  it('archives a row on a short quick flick right', async () => {
    const { row, emitted } = await mountRow({ mail: thread('in'), mailbox: 'in' })
    await drag(row, 100, 150, 5)
    expect(emitted.archive).toHaveBeenCalledOnce()
  })

  it('takes an archived row back to the Inbox from Archive', async () => {
    const { row, emitted } = await mountRow({ mail: thread('ar'), mailbox: 'ar' })
    await drag(row, 100, 260, 50)
    expect(emitted.unarchive).toHaveBeenCalledOnce()
    expect(emitted.archive).not.toHaveBeenCalled()
  })

  it('asks to delete a Trash row for good swiped left, and archives it swiped right', async () => {
    const { row, emitted } = await mountRow({ mail: thread('tr'), mailbox: 'tr' })
    await drag(row, 300, 140, 50)
    expect(emitted.delete).toHaveBeenCalledOnce()
    expect(emitted.trash).not.toHaveBeenCalled()
    await drag(row, 100, 260, 50)
    expect(emitted.archive).toHaveBeenCalledOnce()
  })

  it('discards a draft swiped left, and files nothing swiped right', async () => {
    const { row, emitted } = await mountRow({ mail: thread('dr'), mailbox: 'dr', drafts: true })
    await drag(row, 300, 140, 50)
    await drag(row, 100, 260, 50)
    expect(emitted.delete).toHaveBeenCalledOnce()
    expect(emitted.trash).not.toHaveBeenCalled()
    expect(emitted.archive).not.toHaveBeenCalled()
  })

  it('lets another row swipe while one the list keeps is on its way back', async () => {
    // Nothing takes either row off the list here, as Starred keeps a row it archives
    const first = await mountRow({ mail: thread('in'), mailbox: 'in' })
    const second = await mountRow({ mail: thread('in'), mailbox: 'in' })
    await drag(first.row, 100, 260, 50, 500)
    expect(first.emitted.archive).toHaveBeenCalledOnce()
    await drag(second.row, 100, 260, 50)
    expect(second.emitted.archive).toHaveBeenCalledOnce()
  })

  it('leaves the row alone while rows are being selected', async () => {
    const { row, emitted } = await mountRow({
      mail: thread('in'),
      mailbox: 'in',
      selectionMode: true,
    })
    await drag(row, 300, 140, 50)
    await drag(row, 100, 300, 50)
    expect(emitted.archive).not.toHaveBeenCalled()
    expect(emitted.trash).not.toHaveBeenCalled()
  })
})
