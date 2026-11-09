import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'
import { TransportError } from '@/platform/transport'

import ScheduleMeetingDialog from './ScheduleMeetingDialog.vue'

const state = vi.hoisted(() => ({
  run: vi.fn().mockResolvedValue({}),
  loadUser: vi.fn().mockResolvedValue(undefined),
  account: 'personal',
  admin: false,
}))

vi.mock('@/platform/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/session')>()
  return {
    ...original,
    useSession: () => ({
      ...original.useSession(),
      capabilities: { value: { suiteAdmin: state.admin, jmap: !!state.account } },
      user: { value: { is_mail_server_configured: true } },
    }),
  }
})
vi.mock('@/platform/feedback', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    promise: (promise: Promise<unknown>, options: { error: (error: unknown) => string }) =>
      promise.catch(options.error),
  },
}))
vi.mock('@/api', async (importOriginal) => ({
  api: (await importOriginal<typeof import('@/api')>()).api,
  useQuery: () => ({ data: { name: 'me@example.com', full_name: 'Me' } }),
  useMutation: () => ({ run: state.run, isPending: false }),
}))
vi.mock('@/apps/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/calendar')>()),
  useCalendarUserStore: () => ({
    get accountId() {
      return state.account
    },
    loadUser: state.loadUser,
    userResource: { data: { name: 'me@example.com', full_name: 'Me' } },
  }),
  ParticipantSelector: defineComponent({
    props: ['modelValue', 'displayParticipants'],
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        h('div', [
          h(
            'span',
            props.displayParticipants.map((person: { email: string }) => person.email).join(', '),
          ),
          h(
            'button',
            { onClick: () => emit('update:modelValue', [{ email: 'guest@example.com' }]) },
            'Invite guest',
          ),
        ])
    },
  }),
}))
vi.mock('frappe-ui', () => ({
  Alert: defineComponent({
    props: ['title', 'theme'],
    setup(props) {
      return () => h('div', { role: props.theme === 'red' ? 'alert' : 'status' }, props.title)
    },
  }),
  Dialog: defineComponent({
    props: ['open'],
    setup(props, { slots }) {
      return () => (props.open ? h('div', [slots.default?.(), slots.actions?.()]) : null)
    },
  }),
  FormControl: defineComponent({
    props: ['modelValue', 'label', 'type'],
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        h('input', {
          'aria-label': props.label,
          value: props.modelValue,
          type: props.type || 'text',
          onInput: (event: Event) =>
            emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
        })
    },
  }),
  Button: defineComponent({
    props: ['disabled'],
    setup(props, { slots, attrs }) {
      return () => h('button', { ...attrs, disabled: props.disabled }, slots.default?.())
    },
  }),
}))

let cleanup = () => {}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  state.account = 'personal'
  state.admin = false
  state.run.mockResolvedValue({})
  state.loadUser.mockResolvedValue(undefined)
})

async function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduled = vi.fn()
  const app = createApp(ScheduleMeetingDialog, { onScheduled: scheduled })
  const dialog = fromPartial<InstanceType<typeof ScheduleMeetingDialog>>(app.mount(root))
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  await dialog.show()
  await nextTick()
  return { root, scheduled }
}

describe('Shared meeting scheduler', () => {
  it('schedules with ⌘Enter, including the organizer and invited people', async () => {
    const { root, scheduled } = await mount()
    for (const [label, value] of [
      ['Date', '2026-10-08'],
      ['Start', '14:00'],
      ['End', '15:00'],
    ]) {
      const input = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
      input.value = value!
      input.dispatchEvent(new Event('input'))
      await nextTick()
    }
    const buttons = () => [...root.querySelectorAll<HTMLButtonElement>('button')]
    buttons()
      .find((button) => button.textContent === 'Invite guest')!
      .click()
    await nextTick()
    root.querySelector('input')!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await vi.waitFor(() => expect(scheduled).toHaveBeenCalledOnce())
    expect(state.run).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'personal',
        title: '',
        start: '2026-10-08T14:00:00',
        duration: 'PT1H',
        participants: [
          expect.objectContaining({ email: 'me@example.com', participation_status: 'ACCEPTED' }),
          { email: 'guest@example.com' },
        ],
        send_scheduling_messages: true,
      }),
    )
    expect(root.querySelector('input')).toBeNull()
  })

  it.each([false, true])('offers account recovery appropriate to admin=%s', async (admin) => {
    state.account = ''
    state.admin = admin
    const { root } = await mount()
    expect(root.querySelector('input')).toBeNull()
    expect(root.textContent).toContain(admin ? 'Open Admin users' : 'Ask your admin to add one')
    expect(root.textContent?.includes('Open Admin users')).toBe(admin)
    expect(state.run).not.toHaveBeenCalled()
  })

  it('retries account loading without claiming setup is missing', async () => {
    state.loadUser.mockRejectedValueOnce(new Error('offline'))
    const { root } = await mount()
    expect(root.textContent).toContain('Could not load Calendar account. Retry')
    expect(root.textContent).not.toContain('Ask your admin')
    root.querySelector<HTMLButtonElement>('button')?.click()
    await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull())
  })

  it.each([
    [
      new TransportError({
        type: 'ValidationError',
        status: 417,
        message: 'Choose a writable calendar.',
      }),
      'Choose a writable calendar.',
    ],
    [
      new TransportError({ type: 'NetworkError', status: 0, message: 'private network details' }),
      'Your details are kept. Please try again.',
    ],
  ])('retains fields after %s and succeeds on retry', async (error, message) => {
    state.run.mockRejectedValueOnce(error)
    const { root, scheduled } = await mount()
    for (const [label, value] of [
      ['Title', 'Design review'],
      ['Date', '2026-12-08'],
      ['Start', '14:00'],
      ['End', '15:00'],
    ]) {
      const input = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
      input.value = value!
      input.dispatchEvent(new Event('input'))
      await nextTick()
    }
    const click = (text: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === text)!
        .click()
    click('Invite guest')
    await nextTick()
    click('Schedule')
    await vi.waitFor(() =>
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(message),
    )
    expect(root.textContent).not.toContain('private')
    expect(scheduled).not.toHaveBeenCalled()
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value).toBe(
      'Design review',
    )
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Date"]')?.value).toBe(
      '2026-12-08',
    )
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Start"]')?.value).toBe('14:00')
    expect(root.querySelector<HTMLInputElement>('input[aria-label="End"]')?.value).toBe('15:00')
    expect(root.textContent).toContain('guest@example.com')
    click('Schedule')
    await vi.waitFor(() => expect(scheduled).toHaveBeenCalledOnce())
    expect(root.querySelector('input')).toBeNull()
  })
})
