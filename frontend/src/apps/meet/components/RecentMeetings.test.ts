import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import RecentMeetings from './RecentMeetings.vue'

const state = vi.hoisted(() => ({
  data: [] as { id: string; title: string; last_joined: string; recording?: string }[],
  push: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: state.push }) }))
vi.mock('@/apps/drive', () => ({ driveNodeRoute: (id: string) => ({ path: `/d/${id}` }) }))
vi.mock('@/platform/session', () => ({
  useSession: () => ({ user: { value: { id: 'faris@example.com' } } }),
}))
vi.mock('frappe-ui', () => ({
  useCall: (options: { url: string }) => {
    expect(options.url).toBe('/api/v2/method/suite.meet.api.recents.get_recent_meetings')
    return {
      data: state.data,
      loading: false,
      error: null,
      reload: vi.fn().mockResolvedValue(undefined),
    }
  },
  Button: defineComponent({
    props: ['label'],
    setup:
      (props, { attrs }) =>
      () =>
        h('button', attrs, props.label),
  }),
}))
vi.mock('frappe-ui/list', () => {
  const container = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
  return { List: container, ListRow: container, ListCell: container }
})
let cleanup: () => void
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 5, 12))
})
afterEach(() => {
  cleanup?.()
  state.push.mockClear()
  vi.useRealTimers()
})
function mount() {
  const root = document.createElement('div')
  const app = createApp(RecentMeetings)
  app.mount(root)
  cleanup = () => app.unmount()
  return root
}
describe('Recent meetings', () => {
  it('offers an icon-only playback action for a completed recording', () => {
    state.data = [
      {
        id: 'abcd-efgh-ijkl',
        title: 'Review',
        last_joined: '2026-10-05 10:00:00',
        recording: 'recording-file',
      },
    ]
    const root = mount()
    const play = root.querySelector('button[aria-label="Play recording"]')
    expect(play).not.toBeNull()
    expect(play!.textContent).toBe('')
    expect(root.textContent).toContain('Join')
  })
  it.each([
    ['2026-10-05 10:00:00', 'Today'],
    ['2026-10-04 10:00:00', 'Yesterday'],
    ['2026-10-01 10:00:00', 'Thursday'],
    ['2026-09-30 10:00:00', 'Wednesday'],
  ])('labels %s as %s beside the time', (last_joined, label) => {
    state.data = [{ id: 'abcd-efgh-ijkl', title: 'Review', last_joined }]
    expect(mount().textContent).toContain(`${label}, 10:00 am`)
  })
  it('uses the meeting id when there is no title', () => {
    state.data = [{ id: 'abcd-efgh-ijkl', title: '', last_joined: '2026-10-05 10:00:00' }]
    const root = mount()
    expect(root.textContent).toContain('abcd-efgh-ijkl')
    expect(root.textContent).not.toContain('Untitled meeting')
  })
  it('hides the section when there are no visits', () => {
    state.data = []
    expect(mount().textContent).toBe('')
  })
  it('shows a visited room and lets the user rejoin', () => {
    state.data = [
      { id: 'abcd-efgh-ijkl', title: 'Design review', last_joined: '2026-10-05 10:00:00' },
    ]
    const root = mount()
    expect(root.textContent).toContain('Recent')
    expect(root.textContent).toContain('Design review')
    expect(root.textContent).toContain('Today')
    expect(root.textContent).toContain('10:00 am')
    root.querySelector('button')!.click()
    expect(state.push).toHaveBeenCalledWith({
      name: 'meet-meeting',
      params: { meetingId: 'abcd-efgh-ijkl' },
    })
  })
})
