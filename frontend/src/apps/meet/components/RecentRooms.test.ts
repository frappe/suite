import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import type { Operation } from '@/platform/transport'

import RecentRooms from './RecentRooms.vue'

const state = vi.hoisted(() => ({
  push: vi.fn(),
  request: vi.fn(),
  writeText: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  rooms: new Array<unknown>(),
  inviteRoom: ((): string | null => null)(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: state.push,
    resolve: ({ params }: { params: { meetingId: string } }) => ({
      href: `/meet/${params.meetingId}`,
    }),
  }),
}))
vi.mock('@/platform/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/session')>()
  return {
    ...original,
    useSession: () => ({ ...original.useSession(), user: { value: { id: 'ana@example.com' } } }),
  }
})
vi.mock('@/api', async () => {
  const { api } = await vi.importActual<typeof import('@/api')>('@/api')
  const { createApiClient } = await import('@/platform/server-state')
  const engine = createApiClient(
    // Reads always refetch; writes use Meet's real effects, so they refresh what they affect.
    {
      meet: async () => {
        const { registration } = await import('../client/policy')
        return {
          policy: <I, O>(reference: Operation<I, O>) =>
            reference.kind === 'query' ? { staleTime: 0 } : registration.policy(reference),
        }
      },
    },
    { transport: { request: state.request } },
  )
  return { api, useMutation: engine.useMutation, useQuery: engine.useQuery }
})
vi.mock('frappe-ui', () => ({
  toast: state.toast,
  Dialog: { render: () => null },
  Switch: { render: () => null },
  TextInput: { render: () => null },
  // Each option as a button, so the menu can be read and used by label.
  Dropdown: defineComponent({
    props: ['options'],
    setup: (props) => () =>
      h(
        'div',
        { role: 'menu' },
        (Array.isArray(props.options) ? props.options : []).map(
          (option: { label: string; disabled?: boolean; onClick: () => void }) =>
            h('button', { disabled: option.disabled, onClick: option.onClick }, option.label),
        ),
      ),
  }),
  Badge: defineComponent({ props: ['label'], setup: (props) => () => h('span', props.label) }),
  Tooltip: defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  }),
  Button: defineComponent({
    props: ['label', 'ariaLabel'],
    setup:
      (props, { attrs, slots }) =>
      () =>
        h('button', { ...attrs, 'aria-label': props.ariaLabel }, slots.default?.() ?? props.label),
  }),
}))

let cleanup: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 19, 15, 0))
  state.push.mockClear()
  state.writeText.mockReset().mockResolvedValue(undefined)
  state.toast.success.mockClear()
  state.toast.error.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: state.writeText },
    configurable: true,
  })
  state.request.mockReset()
  state.inviteRoom = null
  state.request.mockImplementation(
    async (reference: { id: string }, input?: { room: string | null }) => {
      if (reference.id === 'set_default_invite_room') {
        state.inviteRoom = input?.room ?? null
        return null
      }
      if (reference.id === 'default_invite_room')
        return { room: state.inviteRoom, meeting_url: null, rooms: [] }
      return state.rooms
    },
  )
  state.rooms = [
    {
      name: 'sale-stea-mroo',
      custom_link: 'sales-team',
      url: `${window.location.origin}/meet/sales-team`,
      title: 'Sales team',
      meeting_type: 'open',
      owner: 'raj@example.com',
      modified: '2026-11-19 11:20:00',
    },
    {
      name: 'abcd-efgh-ijkl',
      custom_link: null,
      url: `${window.location.origin}/meet/abcd-efgh-ijkl`,
      title: null,
      meeting_type: 'restricted',
      owner: 'ana@example.com',
      modified: '2026-11-18 09:00:00',
    },
  ]
})
afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
})

async function mount() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(RecentRooms)
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  await vi.waitFor(() => expect(state.request).toHaveBeenCalled())
  await vi.waitFor(() => expect(root.querySelector('li')).not.toBeNull())
  await nextTick()
  return root
}

const button = (root: HTMLElement, label: string) =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

describe('Recent meets', () => {
  it('offers to use a meet for calendar invites, and to stop once it is used', async () => {
    const root = await mount()
    const menu = (row: number) => root.querySelectorAll('li')[row].querySelector('[role="menu"]')!
    const item = (row: number) => menu(row).querySelector('button')!

    expect(item(1).textContent).toBe('Use for calendar invites')
    item(1).click()
    await vi.waitFor(() => expect(item(1).textContent).toBe('Stop using for calendar invites'))
    expect(item(0).textContent).toBe('Use for calendar invites')
    const row = (index: number) => root.querySelectorAll('li')[index].textContent
    expect(row(1)).toContain('Used for calendar invites')
    expect(row(0)).not.toContain('Used for calendar invites')

    item(1).click()
    await vi.waitFor(() => expect(item(1).textContent).toBe('Use for calendar invites'))
    expect(row(1)).not.toContain('Used for calendar invites')
  })

  it('names each room, marks co-hosted and restricted rooms, and when it was last used', async () => {
    const [sales, untitled] = [...(await mount()).querySelectorAll('li')]

    expect(sales!.textContent).toContain('Sales team')
    expect(sales!.textContent).toContain('Co-host')
    expect(sales!.textContent).toContain('sales-team')
    expect(sales!.textContent).not.toContain('sale-stea-mroo')
    expect(sales!.textContent).not.toContain('/meet/')
    expect(sales!.textContent).toContain('Today')

    expect(untitled!.textContent).toContain('abcd-efgh-ijkl')
    expect(untitled!.textContent).toContain('Restricted')
    expect(untitled!.textContent).not.toContain('Co-host')
    expect(untitled!.textContent!.match(/abcd-efgh-ijkl/g)).toHaveLength(1)
    expect(untitled!.textContent).toContain('Yesterday')
  })

  it('copies the full room link', async () => {
    const root = await mount()

    button(root, 'Copy link to Sales team').click()

    await vi.waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Link copied'))
    expect(state.writeText).toHaveBeenCalledWith(`${window.location.origin}/meet/sales-team`)
  })

  it('says so when the link cannot be copied', async () => {
    state.writeText.mockRejectedValue(new Error('denied'))
    const root = await mount()

    button(root, 'Copy link to Sales team').click()

    await vi.waitFor(() =>
      expect(state.toast.error).toHaveBeenCalledWith('Could not copy the link'),
    )
  })

  it('joins the chosen room', async () => {
    const root = await mount()

    button(root, 'Join abcd-efgh-ijkl').click()

    expect(state.push).toHaveBeenCalledWith({
      name: 'meet-meeting',
      params: { meetingId: 'abcd-efgh-ijkl' },
    })
  })

  it('shows nothing when the user has no rooms', async () => {
    state.rooms = []
    const root = document.createElement('div')
    const app = createApp(RecentRooms)
    app.mount(root)
    cleanup = () => app.unmount()
    await vi.waitFor(() => expect(state.request).toHaveBeenCalled())
    await nextTick()

    expect(root.querySelector('section')).toBeNull()
  })
})
