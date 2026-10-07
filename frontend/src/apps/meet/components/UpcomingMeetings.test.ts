import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import UpcomingMeetings from './UpcomingMeetings.vue'

interface MeetingEvent {
  id: string
  title: string
  start: string
  duration: string
  links?: { href: string }[]
  participants?: { email: string; _name: string }[]
}

const state = vi.hoisted(() => ({
  push: vi.fn(),
  request: vi.fn(),
  account: { accountId: 'personal', loadUser: () => Promise.resolve() },
  events: [] as MeetingEvent[],
}))

// The window the component last asked the calendar for.
const requested = () => state.request.mock.lastCall?.[1]

vi.mock('vue-router', () => ({ useRouter: () => ({ push: state.push }) }))
vi.mock('@/platform/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/session')>()
  return {
    ...original,
    useSession: () => ({ ...original.useSession(), user: { value: { id: 'faris@example.com' } } }),
  }
})
vi.mock('@/apps/calendar/stores/user', () => ({ userStore: () => state.account }))
vi.mock('@/api', async () => {
  const { api } = await vi.importActual<typeof import('@/api')>('@/api')
  const { createApiClient } = await import('@/platform/server-state')
  const engine = createApiClient(
    { calendar: async () => ({ policy: () => ({ staleTime: 0 }) }) },
    { persistence: false, transport: { request: state.request } },
  )
  return { api, useQuery: engine.useQuery }
})
vi.mock('frappe-ui', () => ({
  Avatar: defineComponent({
    props: ['label'],
    setup: (props) => () => h('span', { 'aria-label': props.label }),
  }),
  Button: defineComponent({
    props: ['label', 'ariaLabel', 'href'],
    setup:
      (props, { attrs, slots }) =>
      () =>
        h(
          props.href ? 'a' : 'button',
          { ...attrs, href: props.href, 'aria-label': props.ariaLabel },
          slots.default?.() ?? props.label,
        ),
  }),
}))
vi.mock('frappe-ui/list', () => {
  const container = defineComponent({
    props: ['label'],
    setup:
      (props, { slots }) =>
      () =>
        h('div', [props.label, slots.default?.()]),
  })
  return { List: container, ListGroup: container, ListRow: container, ListCell: container }
})

let cleanup: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval'] })
  vi.setSystemTime(new Date(2026, 8, 30, 8, 0))
  state.push.mockClear()
  state.request.mockReset()
  state.request.mockImplementation(async (reference: { id: string }) => {
    expect(reference.id).toBe('calendar.get_calendar_events')
    return state.events
  })
  state.events = [
    {
      id: 'today',
      title: 'Design review',
      start: '2026-09-30T10:00:00',
      duration: 'PT1H',
      links: [{ href: '/meet/abcd-efgh-ijkl' }],
      participants: [
        { email: 'faris@example.com', _name: 'Faris' },
        { email: 'faris@example.com', _name: 'Faris' },
        { email: 'rushabh@example.com', _name: 'Rushabh' },
      ],
    },
    {
      id: 'tomorrow',
      title: 'Team planning',
      start: '2026-10-01T14:00:00',
      duration: 'PT30M',
      links: [{ href: '/meet/mnop-qrst-uvwx' }],
    },
    { id: 'unrelated', title: 'Not a meeting', start: '2026-09-30T11:00:00', duration: 'PT1H' },
    {
      id: 'later',
      title: 'Later meeting',
      start: '2026-10-02T10:00:00',
      duration: 'PT1H',
      links: [{ href: '/meet/abcd-efgh-ijkl' }],
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
  const app = createApp(UpcomingMeetings)
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  await vi.waitFor(() => expect(state.request).toHaveBeenCalled())
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  return root
}

describe('Meet upcoming list', () => {
  it('shows loading while the initial Calendar request is pending', async () => {
    state.request.mockImplementation(() => new Promise(() => {}))
    const root = await mount()
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Loading meetings…')
  })

  it('shows a failed request and lets the user retry', async () => {
    state.request.mockRejectedValueOnce(new Error('Calendar unavailable'))
    const root = await mount()
    await vi.waitFor(() =>
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(
        'Could not load meetings.',
      ),
    )
    const retry = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry',
    )
    expect(retry).toBeDefined()
    retry!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Design review'))
    expect(root.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows a meeting on another Suite site and joins through its original link', async () => {
    state.events = [
      {
        id: 'external',
        title: 'Remote meeting',
        start: '2026-09-30T23:00:00',
        duration: 'PT45M',
        links: [{ href: 'https://suite.frappe.io/meet/ogga-swbh-almm' }],
      },
    ]
    const root = await mount()
    expect(root.textContent).toContain('Remote meeting')
    expect(root.querySelector('a[aria-label="Join Remote meeting"]')?.getAttribute('href')).toBe(
      'https://suite.frappe.io/meet/ogga-swbh-almm',
    )
    expect(state.push).not.toHaveBeenCalled()
  })

  it('renders nothing when there are no upcoming meetings', async () => {
    state.events = []
    const root = await mount()
    expect(root.textContent).toBe('')
    expect(root.querySelector('section')).toBeNull()
  })

  it('excludes ended meetings and links that are not safe Meet URLs', async () => {
    state.events = [
      {
        id: 'ended',
        title: 'Ended',
        start: '2026-09-30T06:00:00',
        duration: 'PT1H',
        links: [{ href: '/meet/abcd-efgh-ijkl' }],
      },
      {
        id: 'unsafe',
        title: 'Unsafe',
        start: '2026-09-30T23:00:00',
        duration: 'PT1H',
        links: [{ href: 'javascript:alert(1)' }],
      },
      {
        id: 'not-room',
        title: 'Not a room',
        start: '2026-09-30T23:00:00',
        duration: 'PT1H',
        links: [{ href: 'https://suite.frappe.io/meet/recordings' }],
      },
    ]
    const root = await mount()
    expect(root.querySelector('section')).toBeNull()
  })

  it('shows today’s Meet events with date badges and participants and joins the selected room', async () => {
    const root = await mount()
    expect(root.textContent).toContain('Design review')
    expect(root.textContent).toContain('10:00 am – 11:00 am')
    expect(root.textContent).not.toContain('Team planning')
    expect(root.textContent).toContain('Sep')
    expect(root.textContent).toContain('30')
    expect(root.querySelectorAll('[title="Faris"]')).toHaveLength(1)
    expect(root.querySelector('[title="Rushabh"]')).not.toBeNull()
    expect(root.textContent).not.toContain('Not a meeting')
    expect(root.textContent).not.toContain('Later meeting')
    root.querySelector<HTMLButtonElement>('button[aria-label="Join Design review"]')!.click()
    expect(state.push).toHaveBeenCalledWith({
      name: 'meet-meeting',
      params: { meetingId: 'abcd-efgh-ijkl' },
    })
  })

  it('requests only today’s meetings', async () => {
    const root = await mount()
    expect(root.textContent).toContain('Design review')
    expect(root.textContent).not.toContain('Team planning')
    expect(requested()).toMatchObject({
      account: 'personal',
      from_date: '2026-09-30T00:00:00',
      to_date: '2026-09-30T23:59:59',
    })
  })

  it('requests the next day when midnight passes while the tab stays open', async () => {
    const root = await mount()
    expect(root.textContent).toContain('Design review')

    vi.setSystemTime(new Date(2026, 9, 1, 8, 0))
    vi.advanceTimersByTime(30_000)
    await nextTick()

    // The date badges and request window follow the same clock.
    await vi.waitFor(() =>
      expect(requested()).toMatchObject({
        from_date: '2026-10-01T00:00:00',
        to_date: '2026-10-01T23:59:59',
      }),
    )
    await vi.waitFor(() => expect(root.textContent).toContain('Team planning'))
    expect(root.textContent).not.toContain('Design review')
  })
})
