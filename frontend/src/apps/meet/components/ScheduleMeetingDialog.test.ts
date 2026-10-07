import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import ScheduleMeetingDialog from './ScheduleMeetingDialog.vue'

const state = vi.hoisted(() => ({
  run: vi.fn().mockResolvedValue({}),
  loadUser: vi.fn().mockResolvedValue(undefined),
  account: 'personal',
  error: vi.fn(),
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
            emit('update:modelValue', (event.target as HTMLInputElement).value),
        })
    },
  }),
  Button: defineComponent({
    props: ['disabled'],
    setup(props, { slots, attrs }) {
      return () => h('button', { ...attrs, disabled: props.disabled }, slots.default?.())
    },
  }),
  toast: { error: state.error, success: vi.fn(), promise: (promise: Promise<unknown>) => promise },
}))

let cleanup = () => {}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  state.account = 'personal'
})

async function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduled = vi.fn()
  const app = createApp(ScheduleMeetingDialog, { onScheduled: scheduled })
  const dialog = app.mount(root) as unknown as { show: () => Promise<void> }
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

  it('does not open without a Calendar account', async () => {
    state.account = ''
    const { root } = await mount()
    expect(root.querySelector('input')).toBeNull()
    expect(state.error).toHaveBeenCalledWith('Set up Calendar before scheduling a Meet.')
    expect(state.run).not.toHaveBeenCalled()
  })
})
