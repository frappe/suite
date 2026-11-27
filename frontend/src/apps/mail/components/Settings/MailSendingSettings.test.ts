import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { openSettings, settingsSection } from '@/platform/settings'
import { requireTestElement } from '@/platform/testing/dom'

import MailSendingSettings from './MailSendingSettings.vue'

type Reply = { enabled: number; from_date: string | null; to_date: string | null }
const state = vi.hoisted(() => {
  const reply: Reply = { enabled: 1, from_date: null, to_date: null }

  return { save: vi.fn(), reply }
})
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    sieveScripts: { data: [] },
  }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
// The parts this file doesn't open
vi.mock('./ComposeSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('./IdentitySettings.vue', () => ({ default: { render: () => null } }))
vi.mock('./SignatureSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/components/Controls/MailRichTextField.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/platform/feedback', () => ({
  failureLine: (error: Error | null) => error?.message,
}))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  const { fakeMutation } = await import('@/platform/testing/mutations')
  return {
    api: { mail: api },
    useQuery: (reference: { id: string }) => {
      if (reference.id !== 'get_vacation_response') {
        return reactive({ data: [] })
      }

      return reactive({
        isFetching: false,
        data: { ...state.reply, subject: 'Away', html_body: '<p>Back soon</p>' },
        refetch: async () => {},
      })
    },
    useMutation: (reference: { id: string }, options?: { silent?: boolean }) =>
      fakeMutation((input) => state.save(reference.id, input), vi.fn(), options),
    client: {
      mutation: (reference: { id: string }, input: unknown) => state.save(reference.id, input),
    },
  }
})
vi.mock('frappe-ui', () => ({
  FormLabel: { render: () => null },
  ErrorMessage: { render: () => null },
  SettingsHeader: { render: () => null },
  SettingsBody: defineComponent({
    setup(_, { slots }) {
      return () => h('main', slots.default?.())
    },
  }),
  Button: defineComponent({
    props: { label: { type: String, default: '' } },
    setup(props) {
      return () => h('button', props.label)
    },
  }),
  Dialog: defineComponent({
    props: { open: Boolean, title: { type: String, default: '' } },
    setup(props, { slots }) {
      return () => {
        if (!props.open) {
          return null
        }

        return h('dialog', { 'aria-label': props.title }, slots.default?.())
      }
    },
  }),
  FormControl: defineComponent({
    props: { modelValue: { type: String, default: '' }, label: { type: String, default: '' } },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        h('input', {
          'aria-label': props.label,
          value: props.modelValue,
          onInput: (event: Event) =>
            emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
        })
    },
  }),
  Switch: defineComponent({
    props: { modelValue: Boolean },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        h('button', {
          'aria-checked': String(props.modelValue),
          onClick: () => emit('update:modelValue', !props.modelValue),
        })
    },
  }),
  SettingsRow: defineComponent({
    props: { title: { type: String, default: '' }, description: { type: String, default: '' } },
    setup(props, { slots }) {
      return () => h('section', [props.title, h('p', props.description), slots.default?.()])
    },
  }),
}))

let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(MailSendingSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
  return root
}

/** Opens the row with this title and gives back its dialog. */
async function openRow(root: HTMLElement, title: string) {
  const row = Array.from(root.querySelectorAll('section')).find((section) =>
    section.textContent.startsWith(title),
  )
  requireTestElement(row?.querySelector('button'), HTMLButtonElement).click()
  await nextTick()
  return requireTestElement(root.querySelector(`dialog[aria-label="${title}"]`), HTMLElement)
}

/** Types into the field with this label, then presses Save. */
async function saveField(dialog: HTMLElement, label: string, value: string) {
  const field = requireTestElement(
    dialog.querySelector(`input[aria-label="${label}"]`),
    HTMLInputElement,
  )
  field.value = value
  field.dispatchEvent(new Event('input'))
  await nextTick()
  const save = Array.from(dialog.querySelectorAll('button')).find(
    (button) => button.textContent === 'Save',
  )
  requireTestElement(save, HTMLButtonElement).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  window.__ = (text: string) => text
  state.save.mockReset().mockResolvedValue(undefined)
  state.reply = { enabled: 1, from_date: null, to_date: null }
  settingsSection.value = undefined
})
afterEach(() => {
  app.unmount()
  vi.useRealTimers()
})

it('closes Auto-reply once the reply is saved', async () => {
  const root = mount()
  await saveField(await openRow(root, 'Auto-reply'), 'Subject', 'Back on Monday')
  expect(state.save).toHaveBeenCalledWith(
    'update_vacation_response',
    expect.objectContaining({ account: 'personal', enabled: true, subject: 'Back on Monday' }),
  )
  expect(root.querySelector('dialog')).toBeNull()
})
it('keeps Auto-reply open, with what was typed, when the save is refused', async () => {
  state.save.mockRejectedValue(new Error('Dates are the wrong way round'))
  const root = mount()
  await saveField(await openRow(root, 'Auto-reply'), 'Subject', 'Back on Monday')
  const subject = root.querySelector('dialog input[aria-label="Subject"]')
  expect(requireTestElement(subject, HTMLInputElement).value).toBe('Back on Monday')
})
// Midday UTC, so the day reads the same in the zone the tests run in
it.each([
  [
    { enabled: 0, from_date: null, to_date: '2099-11-24T12:00:00Z' },
    'Answers mail for you while you are away.',
  ],
  [{ enabled: 1, from_date: null, to_date: null }, 'Answering mail for you now.'],
  [
    { enabled: 1, from_date: null, to_date: '2099-11-24T12:00:00Z' },
    'Answering mail for you until 24 Nov.',
  ],
  [
    { enabled: 1, from_date: '2099-11-20T12:00:00Z', to_date: '2099-11-24T12:00:00Z' },
    'Starts answering mail for you on 20 Nov.',
  ],
  [
    { enabled: 1, from_date: '2001-03-01T12:00:00Z', to_date: '2001-03-05T12:00:00Z' },
    'Stopped answering mail on 5 Mar.',
  ],
])('says where Auto-reply stands on its row: %o reads %s', (reply, status) => {
  state.reply = reply
  const row = Array.from(mount().querySelectorAll('section')).find((section) =>
    section.textContent.startsWith('Auto-reply'),
  )
  expect(row?.querySelector('p')?.textContent).toBe(status)
})
it('moves the Auto-reply status on when its end passes in a page left open', async () => {
  vi.useFakeTimers({ now: new Date('2026-11-20T11:58:00Z') })
  state.reply = { enabled: 1, from_date: null, to_date: '2026-11-20T12:00:00Z' }
  const row = Array.from(mount().querySelectorAll('section')).find((section) =>
    section.textContent.startsWith('Auto-reply'),
  )
  expect(row?.querySelector('p')?.textContent).toBe('Answering mail for you until 20 Nov.')
  await vi.advanceTimersByTimeAsync(180_000)
  expect(row?.querySelector('p')?.textContent).toBe('Stopped answering mail on 20 Nov.')
})
it.each([
  ['send-as', 'Send-as addresses'],
  ['signatures', 'Signatures'],
  ['auto-reply', 'Auto-reply'],
] as const)('opens %s when Settings is opened on it', (section, title) => {
  openSettings('mail.sending', section)
  expect(mount().querySelector('dialog')?.getAttribute('aria-label')).toBe(title)
})
it('saves a Sent folder switch as it is flipped, sending only that preference', async () => {
  const row = Array.from(mount().querySelectorAll('section')).find((section) =>
    section.textContent.startsWith('Don’t keep sent newsletters'),
  )
  requireTestElement(row?.querySelector('button'), HTMLButtonElement).click()
  await nextTick()
  expect(state.save).toHaveBeenCalledWith('update_account_preferences', {
    account: 'personal',
    changes: { destroy_newsletter_after_submit: 1 },
  })
})
it('puts a Sent folder switch back when its save is refused', async () => {
  state.save.mockImplementation(async (id: string) => {
    if (id === 'update_account_preferences') throw new Error('Server refused the update')
  })
  const root = mount()
  const row = () =>
    Array.from(root.querySelectorAll('section')).find((section) =>
      section.textContent.startsWith('Don’t keep sent newsletters'),
    )
  const toggle = () => requireTestElement(row()?.querySelector('button'), HTMLButtonElement)
  toggle().click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.save).toHaveBeenCalledTimes(1)
  expect(toggle().getAttribute('aria-checked')).toBe('false')
})
