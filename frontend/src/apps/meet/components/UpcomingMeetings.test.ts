import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import UpcomingMeetings from './UpcomingMeetings.vue'

interface MeetingEvent {
  id: string
  title: string
  start: string
  duration: string
  time_zone?: string
  links?: { href: string }[]
  participants?: { email: string; _name: string }[]
}

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const state = vi.hoisted(() => ({
  push: vi.fn(),
  request: vi.fn(),
  account: { accountId: 'personal', loadUser: () => Promise.resolve() },
  events: fromPartial<MeetingEvent[]>([]),
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
    { transport: { request: state.request } },
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
  it.each([
    ['2026-10-29', '2026-10-30'],
    ['2026-10-30', '2026-11-02'],
    ['2026-10-31', '2026-11-02'],
    ['2026-11-01', '2026-11-02'],
    ['2027-12-31', '2028-01-03'],
  ])('includes the next weekday from %s through %s', async (today, lastDay) => {
    vi.setSystemTime(new Date(`${today}T08:00:00`))
    state.events = [today, lastDay].map((date) => ({
      id: date,
      title: date,
      start: `${date}T23:59:59.999`,
      duration: 'PT1H',
      links: [{ href: '/meet/abcd-efgh-ijkl' }],
    }))
    const root = await mount()
    expect(requested()).toMatchObject({
      from_date: new Date(`${today}T00:00:00`).toISOString(),
      to_date: new Date(`${lastDay}T23:59:59.999`).toISOString(),
    })
    expect(root.textContent).toContain(lastDay)
    expect(root.textContent).toContain(today)
  })

  it('keeps Saturday and Sunday meetings between Friday and Monday', async () => {
    vi.setSystemTime(new Date(2026, 9, 30, 8))
    state.events = ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'].map((date) => ({
      id: date,
      title: date,
      start: `${date}T12:00:00`,
      duration: 'PT1H',
      links: [{ href: '/meet/abcd-efgh-ijkl' }],
    }))
    const root = await mount()
    for (const date of ['2026-10-31', '2026-11-01', '2026-11-02'])
      expect(root.textContent).toContain(date)
    expect(root.textContent).not.toContain('2026-11-03')
  })

  it('finds the fourth event after three events without Meet fields', async () => {
    state.events = [
      ...['One', 'Two', 'Three'].map((title, index) => ({
        id: title,
        title,
        start: `2026-09-30T${String(index + 9).padStart(2, '0')}:00:00`,
        duration: 'PT1H',
      })),
      {
        id: 'fourth',
        title: 'Fourth event meeting',
        start: '2026-09-30T14:00:00',
        duration: 'PT1H',
        links: [{ href: '/meet/abcd-efgh-ijkl' }],
      },
    ]
    const root = await mount()
    expect(root.textContent).toContain('Fourth event meeting')
    expect(root.querySelectorAll('button[aria-label^="Join "]')).toHaveLength(1)
  })

  it('shows only the three earliest meetings after filtering nonmeetings', async () => {
    state.events = [14, 11, 13, 12].map((hour) => ({
      id: String(hour),
      title: `Meeting at ${hour}`,
      start: `2026-09-30T${hour}:00:00`,
      duration: 'PT1H',
      links: [{ href: '/meet/abcd-efgh-ijkl' }],
    }))
    const root = await mount()
    expect(
      [...root.querySelectorAll('button[aria-label^="Join "]')].map((row) =>
        row.getAttribute('aria-label'),
      ),
    ).toEqual(['Join Meeting at 11', 'Join Meeting at 12', 'Join Meeting at 13'])
    expect(root.textContent).not.toContain('Meeting at 14')
  })

  it('includes an ongoing meeting using its event timezone', async () => {
    vi.setSystemTime(new Date('2026-09-30T08:00:00Z'))
    state.events = [
      {
        id: 'zoned',
        title: 'Pacific meeting',
        start: '2026-09-30T01:30:00',
        time_zone: 'America/Los_Angeles',
        duration: 'PT1H',
        links: [{ href: '/meet/abcd-efgh-ijkl' }],
      },
    ]
    const root = await mount()
    expect(root.textContent).toContain('Pacific meeting')
  })

  it('orders zoned meetings by instant and excludes meetings beyond the local horizon', async () => {
    vi.setSystemTime(new Date('2026-09-30T08:00:00Z'))
    state.events = [
      {
        id: 'later-zone',
        title: 'Later instant',
        start: '2026-09-30T03:00:00',
        time_zone: 'America/Los_Angeles',
        duration: 'PT1H',
        links: [{ href: '/meet/abcd-efgh-ijkl' }],
      },
      {
        id: 'earlier-zone',
        title: 'Earlier instant',
        start: '2026-09-30T09:00:00',
        time_zone: 'UTC',
        duration: 'PT1H',
        links: [{ href: '/meet/abcd-efgh-ijkl' }],
      },
      {
        id: 'outside',
        title: 'Outside horizon',
        start: '2026-10-01T23:59:00',
        time_zone: 'Pacific/Honolulu',
        duration: 'PT1H',
        links: [{ href: '/meet/abcd-efgh-ijkl' }],
      },
    ]
    const root = await mount()
    expect(
      [...root.querySelectorAll('button[aria-label^="Join "]')].map((row) =>
        row.getAttribute('aria-label'),
      ),
    ).toEqual(['Join Earlier instant', 'Join Later instant'])
    expect(root.textContent).not.toContain('Outside horizon')
  })

  it('hides the section when there are no events', async () => {
    state.events = []
    expect((await mount()).querySelector('section')).toBeNull()
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
    expect(root.textContent).toContain('Team planning')
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

  it('requests today through the next weekday', async () => {
    const root = await mount()
    expect(root.textContent).toContain('Design review')
    expect(root.textContent).toContain('Team planning')
    expect(requested()).toMatchObject({
      account: 'personal',
      from_date: new Date('2026-09-30T00:00:00').toISOString(),
      to_date: new Date('2026-10-01T23:59:59.999').toISOString(),
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
        from_date: new Date('2026-10-01T00:00:00').toISOString(),
        to_date: new Date('2026-10-02T23:59:59.999').toISOString(),
      }),
    )
    await vi.waitFor(() => expect(root.textContent).toContain('Team planning'))
    expect(root.textContent).not.toContain('Design review')
  })
})
