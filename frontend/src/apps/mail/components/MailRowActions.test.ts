import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import MailRowActions from '@/apps/mail/components/MailRowActions.vue'
import type { Thread } from '@/apps/mail/types'

const BOXES = vi.hoisted(() => ({ inbox: 'in', archive: 'ar', trash: 'tr', sent: 'se' }))

vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  const passthrough = () =>
    defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    })
  return { Tooltip: passthrough(), usePortalTarget: () => undefined }
})
vi.mock('@/apps/mail/components/ReminderMenu.vue', async () => {
  const { defineComponent } = await import('vue')
  return {
    default: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => ({ mailboxIds: BOXES }) }))
const screen = vi.hoisted(() => ({ isMobile: { value: false } }))
vi.mock('@/apps/mail/utils/composables', () => ({ useScreenSize: () => screen }))
screen.isMobile = ref(false)

const thread = (boxes: string[], fields: Partial<Thread> = {}) =>
  fromPartial<Thread>({
    seen: 1,
    flagged: 0,
    pinned: 0,
    mailboxes: boxes.map((id) => ({ mailbox_id: id })),
    ...fields,
  })

describe('a pinned row at rest', () => {
  const atRest = (fields: Partial<Thread>, isMobile = false) => {
    screen.isMobile.value = isMobile
    const onSetPinned = vi.fn()
    const el = document.createElement('div')
    const app = createApp({
      render: () =>
        h(MailRowActions, {
          isHovered: false,
          threads: [thread([BOXES.inbox], fields)],
          pinnable: true,
          onSetPinned,
        }),
    })
    app.config.globalProperties.__ = (text: string) => text
    app.mount(el)
    const unpin = el.querySelector<HTMLButtonElement>('button[aria-label="Unpin"]')
    unpin?.click()
    app.unmount()
    screen.isMobile.value = false
    return { unpin, onSetPinned }
  }

  it('keeps its unpin button, which unpins', () => {
    const { unpin, onSetPinned } = atRest({ pinned: 1 })
    expect(unpin).not.toBeNull()
    expect(onSetPinned).toHaveBeenCalledWith(false)
  })

  it('shows no pin button on a row that is not pinned', () => {
    expect(atRest({ pinned: 0 }).unpin).toBeNull()
  })

  it('keeps it as a tap target on a phone, which has no hover actions', () => {
    const { unpin, onSetPinned } = atRest({ pinned: 1 }, true)
    expect(unpin).not.toBeNull()
    expect(onSetPinned).toHaveBeenCalledWith(false)
    expect(atRest({ pinned: 0 }, true).unpin).toBeNull()
  })
})
