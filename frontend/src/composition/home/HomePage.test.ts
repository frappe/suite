import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import type { CalendarEvent } from '@/apps/calendar'
import HomePage from '@/composition/home/HomePage.vue'

const state = vi.hoisted(() => ({
  recentFails: true,
  upcomingFails: false,
  upcomingPending: false,
  push: vi.fn(),
  createDocument: vi.fn(),
  events: null as
    | (Partial<Omit<CalendarEvent, 'participants'>> & {
        participants?: Partial<CalendarEvent['participants'][number]>[]
      })[]
    | null,
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
          props.label || slots.default?.(),
        )
    },
  })
  const Dropdown = defineComponent({
    props: {
      options: {
        type: Array,
        default: () => [],
      },
    },
    setup(props, { slots }) {
      return () =>
        h('div', [
          slots.default?.(),
          ...(
            props.options as Array<{
              label: string
              onClick?: () => void
            }>
          ).map((option) =>
            h(
              'button',
              {
                onClick: option.onClick,
              },
              option.label,
            ),
          ),
        ])
    },
  })
  return {
    Avatar: defineComponent({
      props: ['label'],
      setup: (props) => () => h('span', { 'aria-label': props.label }),
    }),
    Button,
    Dialog: passthrough,
    Dropdown,
    FormControl: passthrough,
    PageHeader: passthrough,
    PageHeaderMobile: passthrough,
    PageHeaderTitle: passthrough,
    ScrollArea: passthrough,
    SidebarItem: passthrough,
    SidebarLabel: passthrough,
    Skeleton: passthrough,
    toast: {
      success: vi.fn(),
    },
  }
})
vi.mock('frappe-ui/list', async () => {
  const { defineComponent, h } = await import('vue')
  const component = (includeLabel = false) =>
    defineComponent({
      inheritAttrs: false,
      props: {
        label: String,
      },
      setup(props, { attrs, slots }) {
        return () => h('div', attrs, [includeLabel ? props.label : null, slots.default?.()])
      },
    })
  return {
    List: component(),
    ListCell: component(),
    ListGroup: component(true),
    ListRow: component(),
  }
})
vi.mock('vue-router', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    RouterLink: defineComponent({
      setup(_props, { slots }) {
        return () => h('a', slots.default?.())
      },
    }),
    useRouter: () => ({
      push: state.push,
    }),
  }
})
vi.mock('@/shell/useIsMobile', async () => {
  const { ref } = await import('vue')
  return {
    isMobile: ref(false),
  }
})

vi.mock('@/platform/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/session')>()
  return {
    ...original,
    useSession: () => ({ ...original.useSession(), user: { value: { id: 'me@example.com' } } }),
  }
})

vi.mock('@/apps/drive', async (importOriginal) => ({
  // Drive's own listing date, so the Recent meta is checked against Drive's format.
  formatDriveListingDate: (await importOriginal<typeof import('@/apps/drive')>())
    .formatDriveListingDate,
  DriveFileCard: defineComponent({
    props: {
      node: Object,
      meta: String,
    },
    setup: (props) => () =>
      h(
        'a',
        `${
          (
            props.node as {
              title: string
            }
          ).title
        } ${props.meta}`,
      ),
  }),
  driveRecents: () => ({
    test: 'recent',
  }),
  useDrivePreviewRefresh: () => {},
  useDriveDocumentCreation: () => ({
    isPending: false,
    run: state.createDocument,
  }),
  driveNodeRoute: (node: { name: string }) => `/d/${node.name}/document`,
}))
vi.mock('@/apps/calendar', async (importOriginal) => ({
  UpcomingEventList: (await importOriginal<typeof import('@/apps/calendar')>()).UpcomingEventList,
  useUpcomingEvents: (await importOriginal<typeof import('@/apps/calendar')>()).useUpcomingEvents,
}))
vi.mock('@/apps/meet', () => ({
  createRoom: {
    test: 'create-room',
  },
  scheduleMeeting: {
    test: 'schedule-meeting',
  },
}))
vi.mock('@/api', async () => ({
  api: (await import('@/composition/api')).api,
  useQuery: (reference: { id: string }) => {
    if (reference.id === 'view_list') {
      return state.recentFails
        ? failedQuery('Recent failed')
        : successfulData({
            rows: [
              {
                name: 'folder-1',
                title: 'Planning',
                kind: 'folder',
                content_doctype: null,
                mime: null,
                opened_at: new Date().toISOString(),
              },
              {
                name: 'node-1',
                title: 'Roadmap',
                kind: 'document',
                content_doctype: 'Writer Document',
                mime: null,
                opened_at: new Date(Date.now() - 6 * 60_000).toISOString(),
              },
            ],
            next_cursor: null,
          })
    }
    if (state.upcomingPending) return { ...successfulData(undefined), status: 'pending' }
    return state.upcomingFails
      ? failedQuery('Upcoming failed')
      : successfulData(
          state.events ?? [
            {
              id: 'event-1',
              title: 'Design review',
              start: new Date().toISOString(),
              conferencing: null,
            },
          ],
        )
  },
  useMutation: (reference: { id: string }) => ({
    isPending: false,
    error: null,
    run:
      reference.id === 'create-document'
        ? state.createDocument
        : vi.fn().mockResolvedValue(undefined),
  }),
}))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.useRealTimers()
  state.push.mockReset()
  state.createDocument.mockReset()
  state.recentFails = true
  state.upcomingFails = false
  state.upcomingPending = false
  state.events = null
  sessionStorage.clear()
})
describe('Home page', () => {
  it('shows only the three earliest upcoming events', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0))
    state.events = [18, 14, 17, 15].map((hour) => ({
      id: String(hour),
      title: `Event ${hour}`,
      start: `2026-10-06T${hour}:00:00`,
    }))
    const root = mount()
    const upcoming = root.querySelector('[data-testid="upcoming-rows"]')
    expect(
      [...upcoming!.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Open Event 14', 'Open Event 15', 'Open Event 17'])
    expect(upcoming?.textContent).not.toContain('Event 18')
  })

  it('announces upcoming loading and keeps its placeholders non-interactive', () => {
    state.upcomingPending = true
    const root = mount()
    const loading = root.querySelector('[role="status"][aria-label="Loading upcoming events"]')
    expect(loading).not.toBeNull()
    expect(loading?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)
    expect(loading?.querySelector('button, a')).toBeNull()
  })

  it('shows five participant avatars and the remaining count', () => {
    state.events = [
      {
        id: 'crowd',
        title: 'Crowd',
        start: new Date().toISOString(),
        participants: Array.from({ length: 7 }, (_, index) => ({
          email: `guest${index}@example.com`,
          _name: `Guest ${index}`,
        })),
      },
    ]
    const root = mount()
    const people = root.querySelector('[aria-label="Open Crowd"] [aria-label="Invited people"]')
    expect(people?.querySelectorAll('[aria-label^="Guest "]')).toHaveLength(5)
    expect(people?.textContent).toContain('2+')
    expect(people?.querySelector('[title="Guest 4"]')).not.toBeNull()
    expect(people?.querySelector('[title="Guest 5"]')).toBeNull()
  })

  it('shows invited people but hides avatars for an event with only yourself', () => {
    state.events = [
      {
        id: 'solo',
        title: 'Solo',
        start: new Date().toISOString(),
        participants: [{ email: 'me@example.com', _name: 'Me' }],
      },
      {
        id: 'team',
        title: 'Team',
        start: new Date().toISOString(),
        participants: [
          { email: 'me@example.com', _name: 'Me' },
          { email: 'guest@example.com', _name: 'Guest' },
        ],
      },
    ]
    const root = mount()
    expect(root.querySelector('[aria-label="Open Solo"] [aria-label="Invited people"]')).toBeNull()
    expect(root.querySelector('[aria-label="Open Team"] [title="Guest"]')).not.toBeNull()
  })

  it('shows ordinary events and meetings today and tomorrow using date badges', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0))
    state.events = [
      { id: 'ordinary', title: 'Focus time', start: '2026-10-06T14:00:00', conferencing: null },
      {
        id: 'meeting',
        title: 'Team sync',
        start: '2026-10-07T10:00:00',
        conferencing: { meeting_id: 'abcd-efgh-ijkl', url: '/meet/abcd-efgh-ijkl' },
      },
      {
        id: 'all-day',
        title: 'Holiday',
        start: '2026-10-07T00:00:00',
        show_without_time: 1,
        conferencing: null,
      },
    ]
    const root = mount()
    const upcoming = root.querySelector('[data-testid="upcoming-rows"]')
    expect(upcoming?.textContent).not.toContain('Today')
    expect(upcoming?.textContent).not.toContain('Tomorrow')
    expect(upcoming?.textContent).toContain('Focus time')
    expect(upcoming?.textContent).toContain('Team sync')
    expect(upcoming?.textContent).toContain('All day')
    expect(upcoming?.querySelector('[aria-label="Open Focus time"]')?.getAttribute('route')).toBe(
      '/calendar',
    )
    expect(upcoming?.querySelector('[aria-label="Join Team sync"]')?.getAttribute('route')).toBe(
      '/meet/abcd-efgh-ijkl',
    )
    expect(upcoming?.querySelector('.capitalize')?.textContent).toMatch(/oct/i)
  })

  it('keeps Upcoming rendered when Recent fails', () => {
    const root = mount()
    expect(root.querySelector('[data-testid="recent-error"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="upcoming-rows"]')?.textContent).toContain(
      'Design review',
    )
  })
  it('keeps Recent rendered when Upcoming fails', () => {
    state.recentFails = false
    state.upcomingFails = true
    const root = mount()
    expect(root.querySelector('[data-testid="recent-rows"]')?.textContent).toContain('Roadmap')
    expect(root.querySelector('[data-testid="upcoming-error"]')).not.toBeNull()
  })
  it('shows recent documents without folders, dated the way Drive dates them', () => {
    // Midday, so six minutes ago is still today.
    vi.useFakeTimers({
      toFake: ['Date'],
    })
    vi.setSystemTime(new Date(2026, 9, 2, 12, 0))
    state.recentFails = false
    const root = mount()
    const recent = root.querySelector('[data-testid="recent-rows"]')?.textContent ?? ''
    expect(recent).toContain('Roadmap 6 min ago')
    expect(recent).not.toContain('Planning')
  })
  it.each([
    ['Document', 'Writer Document'],
    ['Spreadsheet', 'Sheet'],
    ['Presentation', 'Presentation'],
  ])(
    'creates a %s through generic Drive creation and navigates to it',
    async (label, contentDoctype) => {
      state.createDocument.mockResolvedValue({
        name: 'new-node',
      })
      const root = mount()
      const documentButton = [...root.querySelectorAll('button')].find(
        (button) => button.textContent === label,
      )
      documentButton?.click()
      await nextTick()
      await nextTick()
      expect(state.createDocument).toHaveBeenCalledWith({
        content_doctype: contentDoctype,
      })
      expect(state.push).toHaveBeenCalledWith('/d/new-node/document')
    },
  )
})
function mount(): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(HomePage)
  app.mount(root)
  cleanups.push(() => {
    app.unmount()
    root.remove()
  })
  return root
}
function failedQuery(message: string) {
  return {
    data: undefined,
    rows: [],
    status: 'error',
    error: {
      message,
    },
    refetch: vi.fn(),
  }
}
function successfulData(data: unknown) {
  return {
    data,
    rows: [],
    status: 'success',
    error: null,
    refetch: vi.fn(),
  }
}
