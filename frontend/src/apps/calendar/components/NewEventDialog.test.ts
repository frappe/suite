import { createPinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import type { CreatedEvent, NewEventDraft } from '@/apps/calendar'
import { format } from '@/platform/translation/format'

// A closed dialog's fade, held until a test lets it finish.
const fading = vi.hoisted(() => ({ finish: () => {} }))

// frappe-ui's dialogs and buttons as plain elements: a dialog is its title, message, body and
// actions while open, teleported to <body> as frappe-ui's are, and its own close (Escape, the
// backdrop) is a button. Closing it fades until `fading.finish()`.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h, Teleport, watch } = await import('vue')
  const passthrough = defineComponent({
    inheritAttrs: false,
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
  return {
    Button: defineComponent({
      props: { label: String, disabled: Boolean },
      emits: ['click'],
      setup:
        (props, { slots, emit }) =>
        () =>
          h('button', { disabled: props.disabled, onClick: () => emit('click') }, [
            props.label,
            slots.default?.(),
          ]),
    }),
    Dialog: defineComponent({
      props: { open: Boolean, title: String, message: String },
      emits: ['update:open', 'after-leave'],
      setup: (props, { slots, emit }) => {
        watch(
          () => props.open,
          (open) => {
            if (!open) fading.finish = () => emit('after-leave')
          },
        )
        return () =>
          h(Teleport, { to: 'body' }, [
            props.open
              ? h('div', { role: 'dialog' }, [
                  props.title,
                  props.message,
                  slots.default?.(),
                  slots.actions?.(),
                  h('button', { 'data-dismiss': '', onClick: () => emit('update:open', false) }),
                ])
              : null,
          ])
      },
    }),
    FormControl: defineComponent({
      props: { modelValue: [String, Number, Boolean] },
      setup: (props) => () => h('input', { value: props.modelValue }),
    }),
    Avatar: passthrough,
    BottomSheet: passthrough,
    Combobox: passthrough,
    Dropdown: passthrough,
    LoadingIndicator: passthrough,
    Radio: passthrough,
    RadioGroup: passthrough,
    Switch: passthrough,
    TabButtons: passthrough,
    Tooltip: passthrough,
    toast: {
      success: () => {},
      error: () => {},
      info: () => {},
      promise: (
        saving: Promise<unknown>,
        messages: { success: string | ((result: unknown) => Shown | Promise<Shown>) },
      ) => {
        void saving.then(async (result) =>
          toasts.push(
            typeof messages.success === 'function'
              ? await messages.success(result)
              : messages.success,
          ),
        )
      },
    },
  }
})
vi.mock('reka-ui', async (original) => {
  const { defineComponent, h } = await import('vue')
  const passthrough = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
  return { ...(await original<object>()), DialogTitle: passthrough, DialogDescription: passthrough }
})

// A toast as the form shows it: its words, and what it offers beside them.
type Shown = string | { message: string; action: { label: string; onClick: () => void } }
const toasts = vi.hoisted(() => new Array<Shown>())

// A read as the form's stores see it.
interface FakeQuery {
  data: unknown
  status: 'pending' | 'success'
  isFetching: boolean
  error: null
  refetch: () => Promise<unknown>
  cancel: () => void
}

// The server: what each read answers, once `arrival` lets it through, and every write sent.
const server = vi.hoisted(() => ({
  replies: new Map<string, unknown>(),
  arrival: () => Promise.resolve(),
  writes: new Array<{ to: string; input: Record<string, unknown> }>(),
}))
vi.mock('@/api', async (original) => {
  const { reactive, watch } = await import('vue')
  const key = (reference: { owner: string; publicName: string }) =>
    `${reference.owner}.${reference.publicName}`
  return {
    ...(await original<typeof import('@/api')>()),
    useQuery: (
      reference: { owner: string; publicName: string },
      input: unknown | (() => unknown),
    ) => {
      const state: FakeQuery = reactive<FakeQuery>({
        data: undefined,
        status: 'pending',
        isFetching: false,
        error: null,
        refetch: async () => {
          await server.arrival()
          state.data = server.replies.get(key(reference))
          state.status = 'success'
          return state.data
        },
        cancel: () => {},
      })
      watch(
        () => (typeof input === 'function' ? input() : input),
        (asked) => {
          if (asked !== false && server.replies.has(key(reference))) void state.refetch()
        },
        { immediate: true },
      )
      return state
    },
    useMutation: (reference: { owner: string; publicName: string }) => ({
      isPending: false,
      error: null,
      reset: () => {},
      cancel: () => {},
      run: async (input: Record<string, unknown>) => {
        server.writes.push({ to: key(reference), input })
        return 'evt-1'
      },
    }),
  }
})

const ME = 'me@example.com'
const draft: NewEventDraft = {
  title: 'Q4 planning',
  description: 'Shall we meet Thursday at 3pm?',
  start: { date: '2026-11-19', time: '15:00' },
  participants: [
    { email: 'lena@example.com', name: 'Lena' },
    { email: ME, name: 'Me' },
  ],
}

let app: App | undefined
// The window's width as the page loads: Calendar picks its phone or desktop form from it, once.
let screenWidth = 1024
// What went wrong while the form rendered.
const renderErrors = new Array<unknown>()
let router: Router
let open: (draft: NewEventDraft) => Promise<CreatedEvent | undefined>
const page = document.createElement('div')

beforeEach(async () => {
  localStorage.clear()
  toasts.length = 0
  server.writes.length = 0
  server.arrival = () => Promise.resolve()
  server.replies = new Map<string, unknown>([
    [
      'mail.account.get',
      { full_name: 'Me', accounts: [{ id: 'acc', _name: 'Me', is_personal: 1, in_calendar: 1 }] },
    ],
    ['mail.identities.list', [{ email: ME }]],
    ['mail.participantIdentities.list', [{ email: ME, _name: 'Me', default: 1 }]],
    [
      'calendar.calendars.list',
      [{ name: 'acc|cal-1', id: 'cal-1', account: 'acc', _name: 'Personal', may_write_all: 1 }],
    ],
  ])
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  })
  await router.push('/mail/inbox/thread-1')
  vi.spyOn(router, 'push')
  vi.spyOn(router, 'replace')
  // Fresh each time: the dialog host is the page's, and holds the app that first used it.
  vi.resetModules()
  window.innerWidth = screenWidth
  renderErrors.length = 0
  const { useNewEventDialog } = await import('@/apps/calendar')
  // A page in another area, which never visited Calendar, asking for the form.
  app = createApp({
    setup() {
      open = useNewEventDialog()
      return () => h('p', 'The mail')
    },
  })
  app.config.globalProperties.__ = format
  app.config.errorHandler = (error) => renderErrors.push(error)
  app.use(createPinia())
  app.use(router)
  document.body.append(page)
  app.mount(page)
})
afterEach(async () => {
  // Off the page, which closes any form still up, and out of its fade.
  await router.push('/elsewhere')
  await settle()
  fading.finish()
  await settle()
  app?.unmount()
  page.remove()
  document.body.className = ''
})

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve))
    await nextTick()
  }
}
// The form's code loads on the first ask, which takes a moment here.
const opened = () =>
  vi.waitFor(
    () => {
      if (!form()) throw new Error('The form is not open')
    },
    { timeout: 5000 },
  )
const dialogs = () => [...document.querySelectorAll('[role="dialog"]')]
const form = () =>
  dialogs().find((dialog) => dialog.querySelector('input[placeholder="Add title"]'))
const titleField = () => form()?.querySelector<HTMLInputElement>('input[placeholder="Add title"]')
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === label)
const click = async (target: Element | null | undefined) => {
  if (!(target instanceof HTMLElement)) throw new Error('Nothing to click')
  target.click()
  await settle()
}
const loadingFrame = () => document.querySelector('[role="dialog"] [role="status"]')
const created = () => server.writes.filter((write) => write.to === 'calendar.events.create')

describe("Calendar's new-event form opened over another area's page", () => {
  it('opens filled in from the draft, and the page stays where it was', async () => {
    void open(draft)
    await opened()

    expect(titleField()?.value).toBe('Q4 planning')
    expect(page.textContent).toBe('The mail')
    expect(router.currentRoute.value.fullPath).toBe('/mail/inbox/thread-1')
    expect(router.push).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('asks whether to email the guests before it sends anything, then creates the event', async () => {
    void open(draft)
    await opened()

    await click(button('Save'))
    expect(document.body.textContent).toContain(
      "Send an email to let attendees know they've been invited?",
    )
    expect(server.writes).toEqual([])

    await click(button('Send Email'))
    expect(created()).toHaveLength(1)
    const input = created()[0].input
    expect(input).toMatchObject({
      account: 'acc',
      calendar_ids: ['cal-1'],
      title: 'Q4 planning',
      description: 'Shall we meet Thursday at 3pm?',
      start: '2026-11-19T15:00:00',
      duration: 'PT1H',
      send_scheduling_messages: true,
      draft: false,
    })
    // The reader organizes it and is not invited to it as well.
    expect(input.participants).toEqual([
      expect.objectContaining({ email: ME }),
      expect.objectContaining({ email: 'lena@example.com' }),
    ])
    expect(form()).toBeUndefined()
    expect(router.currentRoute.value.fullPath).toBe('/mail/inbox/thread-1')
  })

  it('offers the saved event in Calendar, on its own day, from the toast', async () => {
    void open(draft)
    await opened()
    await click(button('Save'))
    await click(button('Skip'))

    expect(created()[0].input).toMatchObject({ send_scheduling_messages: false })
    const [toast] = toasts
    expect(toast).toEqual({
      message: 'Event created',
      action: { label: 'View in Calendar', onClick: expect.any(Function) },
    })
    if (typeof toast === 'string') return
    toast.action.onClick()
    expect(router.push).toHaveBeenCalledWith({
      path: '/calendar/account/acc/day/2026/11/19',
      query: { event: 'evt-1' },
    })
  })

  it('sends nothing when it is cancelled', async () => {
    const closed = vi.fn()
    void open(draft).then(closed)
    await opened()

    await click(button('Cancel'))
    expect(form()).toBeUndefined()
    expect(closed).toHaveBeenCalled()
    expect(server.writes).toEqual([])
  })

  it('asks before throwing away a changed form, rather than keeping it as a draft unasked', async () => {
    void open(draft)
    await opened()
    const title = titleField()!
    title.value = 'Q4 planning, rescheduled'
    title.dispatchEvent(new Event('input'))
    await settle()

    // Escape, or a click beside the form.
    await click(form()?.querySelector('[data-dismiss]'))
    expect(document.body.textContent).toContain('Discard changes?')
    expect(server.writes).toEqual([])

    await click(button('Discard'))
    expect(form()).toBeUndefined()
    expect(server.writes).toEqual([])
  })

  it('shows the dialog at once, and the form in it once the account and its calendars have come', async () => {
    let arrive = () => {}
    const arrived = new Promise<void>((resolve) => (arrive = resolve))
    server.arrival = () => arrived

    void open(draft)
    await vi.waitFor(() => expect(loadingFrame()).not.toBeNull(), { timeout: 5000 })
    // Without its account the form would have no calendars to offer and no one to look up.
    expect(form()).toBeUndefined()

    arrive()
    await opened()
    expect(loadingFrame()).toBeNull()
    expect(titleField()?.value).toBe('Q4 planning')
    await click(button('Save'))
    await click(button('Send Email'))
    expect(created()[0].input).toMatchObject({ account: 'acc', calendar_ids: ['cal-1'] })
  })

  it('resolves with the event Save made', async () => {
    const closing = open(draft)
    await opened()
    await click(button('Save'))
    await click(button('Skip'))

    await expect(closing).resolves.toEqual({ id: 'evt-1', account: 'acc', date: '2026-11-19' })
  })

  it('closes on Back and leaves the reader on the mail, sending nothing', async () => {
    const closing = open(draft)
    await opened()

    history.back()
    await vi.waitFor(() => expect(form()).toBeUndefined())
    await expect(closing).resolves.toBeUndefined()
    expect(router.currentRoute.value.fullPath).toBe('/mail/inbox/thread-1')
    expect(server.writes).toEqual([])
  })

  it('closes when the page it was asked from goes', async () => {
    const closing = open(draft)
    await opened()

    await router.push('/mail/inbox/thread-2')
    await settle()
    expect(form()).toBeUndefined()
    await expect(closing).resolves.toBeUndefined()
  })

  it('never shows once the reader has left the page while it loaded', async () => {
    let arrive = () => {}
    const arrived = new Promise<void>((resolve) => (arrive = resolve))
    server.arrival = () => arrived

    // Every dialog put on the page, however briefly.
    let shownDialogs = 0
    const watcher = new MutationObserver((changes) => {
      for (const change of changes)
        for (const node of change.addedNodes)
          if (node instanceof Element && node.matches('[role="dialog"]')) shownDialogs++
    })
    watcher.observe(document.body, { childList: true, subtree: true })

    const closing = open(draft)
    await router.push('/mail/inbox/thread-2')
    arrive()
    await expect(closing).resolves.toBeUndefined()
    await settle()
    watcher.disconnect()
    expect(shownDialogs).toBe(0)
  })

  it("keeps Calendar's styles on the page until the dialog has faded out", async () => {
    void open(draft)
    await opened()
    expect(document.body.classList).toContain('calendar-app')

    await click(button('Cancel'))
    expect(form()).toBeUndefined()
    expect(document.body.classList).toContain('calendar-app')

    fading.finish()
    await settle()
    expect(document.body.classList).not.toContain('calendar-app')
  })
})

describe("Calendar's new-event form opened over another area's page, on a phone", () => {
  beforeAll(() => (screenWidth = 390))
  afterAll(() => (screenWidth = 1024))

  it('shows its screen at once, loading, while the account and its calendars come', async () => {
    let arrive = () => {}
    const arrived = new Promise<void>((resolve) => (arrive = resolve))
    server.arrival = () => arrived

    void open(draft)
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')).not.toBeNull(), {
      timeout: 5000,
    })
    expect(document.body.textContent).toContain('New Event')
    expect(renderErrors).toEqual([])

    arrive()
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull())
    // The filled-in form in its place.
    expect(
      [...document.querySelectorAll('input')].some((field) => field.value === 'Q4 planning'),
    ).toBe(true)
    expect(button('Save')).toBeDefined()
    expect(renderErrors).toEqual([])
  })
})
