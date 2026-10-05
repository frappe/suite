import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import UpcomingMeetings from './UpcomingMeetings.vue'

interface CallOptions {
  params: () => { account: string; from_date: string; to_date: string }
}
interface MeetingEvent {
  id: string
  title: string
  start: string
  duration: string
  links?: { href: string }[]
  participants?: { email: string; _name: string }[]
}

const state = vi.hoisted(() => ({
  options: null as CallOptions | null,
  push: vi.fn(),
  account: { accountId: 'personal', userResource: { promise: Promise.resolve(), reload: vi.fn() } },
  events: [] as MeetingEvent[],
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: state.push }) }))
vi.mock('@/platform/session', () => ({
  useSession: () => ({ user: { value: { id: 'faris@example.com' } } }),
}))
vi.mock('@/apps/calendar/stores/user', () => ({ userStore: () => state.account }))
vi.mock('frappe-ui', () => ({
  useCall: (options: CallOptions) => {
    state.options = options
    return {
      data: state.events,
      loading: false,
      error: null,
      reload: vi.fn().mockResolvedValue(undefined),
    }
  },
  Button: defineComponent({
    props: ['label', 'ariaLabel'],
    setup:
      (props, { attrs }) =>
      () =>
        h('button', { ...attrs, 'aria-label': props.ariaLabel }, props.label),
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
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 30, 8, 0))
  state.push.mockClear()
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
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  return root
}

describe('Meet upcoming list', () => {
  it('shows today and later Meet events together and joins the selected room', async () => {
    const root = await mount()
    expect(root.textContent).toContain('Design review')
    expect(root.textContent).toContain('10:00 – 11:00')
    expect(root.textContent).toContain('Team planning')
    expect(root.textContent).not.toContain('Not a meeting')
    root.querySelector<HTMLButtonElement>('button[aria-label="Join Design review"]')!.click()
    expect(state.push).toHaveBeenCalledWith({
      name: 'meet-meeting',
      params: { meetingId: 'abcd-efgh-ijkl' },
    })
  })

  it('shows meetings grouped by day within the next 30 days', async () => {
    const root = await mount()
    expect(root.textContent).toContain('Design review')
    expect(root.textContent).toContain('Team planning')
    expect(root.textContent).toContain('Today')
    expect(root.textContent).toContain('Thu, 1 Oct')
    expect(state.options!.params()).toMatchObject({
      account: 'personal',
      from_date: '2026-09-30T00:00:00',
      to_date: '2026-10-30T23:59:59',
    })
  })
})
