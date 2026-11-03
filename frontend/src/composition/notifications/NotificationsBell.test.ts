import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import NotificationsBell from '@/composition/notifications/NotificationsBell.vue'

const state = vi.hoisted(() => ({
  push: vi.fn(),
  markRead: vi.fn(),
  loadNode: vi.fn(),
}))
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const passthrough = defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h('div', attrs, slots.default?.())
    },
  })
  const Button = defineComponent({
    inheritAttrs: false,
    props: {
      label: String,
    },
    emits: ['click'],
    setup(props, { attrs, emit, slots }) {
      return () =>
        h(
          'button',
          {
            ...attrs,
            onClick: (event: Event) => emit('click', event),
          },
          [props.label || slots.default?.(), slots.suffix?.()],
        )
    },
  })
  const Popover = defineComponent({
    emits: ['update:open'],
    setup(_props, { emit, slots }) {
      return () =>
        h('div', [
          h(
            'div',
            {
              onClick: () => emit('update:open', true),
            },
            slots.trigger?.(),
          ),
          slots.default?.(),
        ])
    },
  })
  return {
    Button,
    Popover,
    ScrollArea: passthrough,
    Skeleton: passthrough,
  }
})
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: state.push,
  }),
}))
vi.mock('@/apps/drive', () => ({
  DRIVE_ROLES: { read: 10, comment: 20, upload: 30, edit: 40, manage: 50 },
  driveNodeRoute: (node: { name: string }) => `/d/${node.name}/item`,
  driveNotifications: () => ({
    test: 'feed',
  }),
  driveUnreadNotificationCount: () => ({
    test: 'count',
  }),
  markDriveNotificationsRead: () => ({
    test: 'mark-read',
  }),
  markAllDriveNotificationsRead: () => ({
    test: 'mark-all-read',
  }),
  loadDriveNodeSummary: state.loadNode,
}))
vi.mock('@/platform/session', async (actual) => {
  const session = await actual<typeof import('@/platform/session')>()
  return {
    ...session,
    useSession: () => ({ ...session.useSession(), user: { value: { id: 'maya@northwind.test' } } }),
  }
})
vi.mock('@/api', async () => ({
  api: (await import('@/composition/api')).api,
  useQuery: () => ({
    data: {
      unread: 1,
    },
    status: 'success',
    error: null,
  }),
  useInfiniteQuery: () => ({
    rows: [shareNotification(), mentionNotification(), commentNotification()],
    status: 'success',
    error: null,
    hasNext: false,
    isFetchingNext: false,
    refetch: vi.fn(),
    fetchNext: vi.fn(),
  }),
  useMutation: () => ({
    isPending: false,
    error: null,
    run: state.markRead,
  }),
}))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  state.push.mockReset()
  state.markRead.mockReset()
  state.loadNode.mockReset()
})
describe('Notifications bell', () => {
  it('reads each notification as a sentence naming the person and the item', () => {
    const rows = notificationRows(mount())
    expect(rows[0]?.textContent).toContain(
      'Theo Williams shared "Beacon deck" with you (can comment)',
    )
    expect(rows[1]?.textContent).toContain('Theo Williams mentioned you in "Q4 Roadmap"')
    expect(rows[1]?.textContent).toContain('Can you check the numbers, @Maya Chen?')
    expect(rows[2]?.textContent).toContain('Theo Williams commented on "Launch plan"')
    expect(rows[2]?.textContent).toContain('The dates moved, @Theo Williams')
    for (const row of rows) {
      expect(row.textContent).not.toMatch(/share_add|share add|theo@northwind\.test/)
    }
  })
  it('marks an unread row with the dot and a bold sentence, not a coloured fill', () => {
    const [row] = notificationRows(mount())
    expect(row?.className).not.toMatch(/bg-surface-amber/)
    expect(row?.querySelector('.text-base-semibold')?.textContent).toContain('Beacon deck')
    expect(row?.querySelector('.bg-surface-amber-7')).not.toBeNull()
  })
  it('does not mark anything read when opened', async () => {
    const root = mount()
    const bell = root.querySelector('[aria-label="Notifications"]') as HTMLButtonElement
    bell.click()
    await nextTick()
    expect(state.markRead).not.toHaveBeenCalled()
  })
  it('marks only the clicked row read before navigating to its node', async () => {
    state.markRead.mockResolvedValue({
      read: 1,
    })
    state.loadNode.mockResolvedValue({
      name: 'node-1',
      title: 'Plan',
      kind: 'document',
    })
    const root = mount()
    const row = [...root.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Beacon deck'),
    )
    row?.click()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(state.markRead).toHaveBeenCalledWith({
      notifications: ['notice-1'],
    })
    expect(state.loadNode).toHaveBeenCalledWith('node-1')
    expect(state.push).toHaveBeenCalledWith('/d/node-1/item')
    expect(state.markRead.mock.invocationCallOrder[0]!).toBeLessThan(
      state.loadNode.mock.invocationCallOrder[0]!,
    )
    expect(state.loadNode.mock.invocationCallOrder[0]!).toBeLessThan(
      state.push.mock.invocationCallOrder[0]!,
    )
  })
  it('still opens a mention of a document the reader has no access to', async () => {
    state.loadNode.mockRejectedValue(new Error('Not found'))
    mount()
    await nextTick()
    const row = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('mentioned you in'),
    )

    row?.click()
    await vi.waitFor(() => expect(state.push).toHaveBeenCalled())

    expect(state.push).toHaveBeenCalledWith(`/d/${mentionNotification().activity.node}/item`)
  })

  it('marks every remaining row only through the explicit action', async () => {
    state.markRead.mockResolvedValue({
      read: 1,
    })
    const root = mount()
    const markAll = [...root.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Mark all read',
    )
    markAll?.click()
    await nextTick()
    expect(state.markRead).toHaveBeenCalledWith({
      all: true,
    })
    expect(state.push).not.toHaveBeenCalled()
  })
})
function mount(): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(NotificationsBell)
  app.mount(root)
  cleanups.push(() => {
    app.unmount()
    root.remove()
  })
  return root
}
function notificationRows(root: HTMLElement): HTMLButtonElement[] {
  return [
    ...root.querySelectorAll<HTMLButtonElement>('[data-testid="notifications-popover"] button'),
  ].filter((button) => button.textContent?.includes('"'))
}
function shareNotification() {
  return notification('notice-1', 'share_add', 'Beacon deck', {
    principal: 'maya@northwind.test',
    old_role: null,
    new_role: 20,
  })
}
function mentionNotification() {
  return notification('notice-2', 'comment', 'Q4 Roadmap', {
    thread: 'thread-1',
    comment: 'comment-1',
    resolved: false,
    excerpt: 'Can you check the numbers, @Maya Chen?',
    mentions: ['maya@northwind.test'],
  })
}
function commentNotification() {
  return notification('notice-3', 'comment', 'Launch plan', {
    thread: 'thread-2',
    comment: 'comment-2',
    resolved: false,
    excerpt: 'The dates moved, @Theo Williams',
    mentions: ['theo@northwind.test'],
  })
}
function notification(
  name: string,
  action: string,
  title: string,
  detail: Record<string, unknown>,
) {
  return {
    name,
    read: 0,
    creation: new Date().toISOString(),
    node_title: title,
    node_kind: 'document',
    actor: {
      id: 'theo@northwind.test',
      full_name: 'Theo Williams',
      user_image: null,
    },
    activity: {
      name: `activity-${name}`,
      node: 'node-1',
      action,
      actor: 'theo@northwind.test',
      at: new Date().toISOString(),
      via_link: null,
      client: null,
      detail,
    },
  }
}
