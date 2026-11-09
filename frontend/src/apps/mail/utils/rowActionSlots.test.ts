import { describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import MailRowActions from '@/apps/mail/components/MailRowActions.vue'
import type { Thread } from '@/apps/mail/types'
import { rowActionSlots } from '@/apps/mail/utils/rowActionSlots'

const BOXES = vi.hoisted(() => ({ inbox: 'in', archive: 'ar', trash: 'tr', sent: 'se' }))

vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  return {
    Tooltip: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => ({ mailboxIds: BOXES }) }))
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref } = await import('vue')
  return { useScreenSize: () => ({ isMobile: ref(false) }) }
})

const thread = (boxes: string[], fields: Partial<Thread> = {}) =>
  // SAFETY: a partial row; these tests read only the fields set here.
  ({
    seen: 1,
    flagged: 0,
    pinned: 0,
    mailboxes: boxes.map((id) => ({ mailbox_id: id })),
    ...fields,
    // SAFETY: a test double standing in for the real value.
  }) as Thread

// The buttons a row shows on hover, plus a stack row's chevron, which sits in the same column.
function shown(props: Record<string, unknown>, chevron = false) {
  const el = document.createElement('div')
  const app = createApp({ render: () => h(MailRowActions, { isHovered: true, ...props }) })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(el)
  const count = el.querySelectorAll('button').length + Number(chevron)
  app.unmount()
  return count
}

describe('the room a list keeps for its row actions', () => {
  it('fits the busiest conversation in the Inbox, pin included', () => {
    const list = { unarchive: true, pinnable: true }
    const busiest = thread([BOXES.inbox], { seen: 0 })

    expect(shown({ threads: [busiest], ...list })).toBeLessThanOrEqual(rowActionSlots(list))
  })

  it('fits a stack whose run holds mail to archive and mail to unarchive', () => {
    const list = { unarchive: true }
    const run = [thread([BOXES.inbox], { seen: 0 }), thread([BOXES.archive])]
    const count = shown({ threads: run, showStar: false, ...list }, true)

    expect(count).toBe(5)
    expect(count).toBeLessThanOrEqual(rowActionSlots(list))
  })

  it('fits a stack in an Inbox beside pinnable rows', () => {
    const list = { unarchive: true, pinnable: true }
    const run = [thread([BOXES.inbox], { seen: 0 }), thread([BOXES.archive])]

    expect(shown({ threads: run, showStar: false, unarchive: true }, true)).toBeLessThanOrEqual(
      rowActionSlots(list),
    )
  })

  it('fits Drafts, which only discards', () => {
    const list = { drafts: true }
    const draft = thread(['dr'], { draft: 1 })

    expect(shown({ threads: [draft], ...list })).toBeLessThanOrEqual(rowActionSlots(list))
  })
})
