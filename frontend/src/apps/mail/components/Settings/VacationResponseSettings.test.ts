import { beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import VacationResponseSettings from './VacationResponseSettings.vue'

const saved = vi.hoisted<{ value: Record<string, unknown> | null }>(() => ({ value: null }))
const run = vi.hoisted(() => vi.fn())
const reported = vi.hoisted(() => vi.fn())
const failureToast = vi.hoisted(() => vi.fn())
// The scripts on the mail server, of which one runs at a time
const scripts = vi.hoisted<{ value: { _name: string; active: number }[] }>(() => ({ value: [] }))

type Answer = { label: string; onClick: () => void }
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const passthrough = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
  return {
    Button: passthrough,
    ErrorMessage: defineComponent({
      props: { message: { type: String, default: undefined } },
      setup(props) {
        return () => props.message && h('p', { role: 'alert' }, props.message)
      },
    }),
    // An open dialog asks its question and offers its answers
    Dialog: defineComponent(
      (props: { open?: boolean; title?: string; message?: string; actions?: Answer[] }) => () => {
        if (!props.open) {
          return null
        }

        return h('div', { role: 'dialog' }, [
          h('h2', props.title),
          h('p', props.message),
          props.actions?.map((action) => h('button', { onClick: action.onClick }, action.label)),
        ])
      },
      { props: ['open', 'title', 'message', 'actions'] },
    ),
    SettingsBody: passthrough,
    SettingsHeader: passthrough,
    SettingsRow: passthrough,
    // Pressed, the switch turns the responder on
    Switch: defineComponent({
      emits: ['update:modelValue'],
      setup:
        (_props, { emit }) =>
        () =>
          h('button', { 'data-switch': '', onClick: () => emit('update:modelValue', true) }),
    }),
    // A field shows what it was handed, its label and its value, and hands back what is typed
    FormControl: defineComponent({
      inheritAttrs: false,
      emits: ['update:modelValue'],
      setup(_props, { attrs, emit }) {
        return () =>
          h('input', {
            'data-label': attrs.label,
            value: attrs.modelValue,
            onInput: (event: Event) =>
              emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
          })
      },
    }),
  }
})
vi.mock('@/api', async () => {
  const { fakeMutation } = await import('@/platform/testing/mutations')
  return {
    api: { mail: { vacation: { get: {}, update: {} } } },
    useQuery: () => ({ data: saved.value }),
    useMutation: (_reference: unknown, options?: { silent?: boolean }) =>
      fakeMutation(run, failureToast, options),
  }
})
vi.mock('@/platform/feedback', () => ({
  failureLine: (error: Error | null) => error?.message,
}))
// The zone the dates are read and typed in
vi.mock('@/platform/session', () => ({
  useSession: () => ({ user: { value: { timeZone: 'Asia/Kolkata' } } }),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ accountId: 'account', sieveScripts: { data: scripts.value } }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
vi.mock('@/apps/mail/components/Controls/MailRichTextField.vue', () => ({
  default: { render: () => h('div', { 'data-message': '' }) },
}))

const LONG_AGO = { from: '2020-06-01T09:00:00Z', to: '2020-06-14T09:00:00Z' }
const AHEAD = { from: '2099-06-01T09:00:00Z', to: '2099-06-14T09:00:00Z' }

const mount = async (enabled: 0 | 1, dates: { from: string; to: string }) => {
  saved.value = {
    enabled,
    from_date: dates.from,
    to_date: dates.to,
    subject: 'Away on a trip',
    html_body: '<p>Back soon</p>',
  }
  const root = document.createElement('div')
  const app = createApp(VacationResponseSettings)
  app.config.globalProperties.__ = (message: string) => message
  app.config.errorHandler = reported
  app.mount(root)
  await nextTick()
  function field(label: string) {
    return root.querySelector<HTMLInputElement>(`[data-label="${label}"]`)
  }

  async function turnOn() {
    root.querySelector<HTMLElement>('[data-switch]')!.click()
    await nextTick()
  }

  return { root, field, turnOn }
}

beforeEach(() => {
  window.__ = (message: string) => message
  run.mockReset()
  reported.mockReset()
  failureToast.mockReset()
  scripts.value = []
})

it('starts from no dates once an absence is off and over, keeping its words', async () => {
  const { field, turnOn } = await mount(0, LONG_AGO)
  await turnOn()
  expect(field('Starts')!.value).toBe('')
  expect(field('Ends (optional)')!.value).toBe('')
  expect(field('Subject')!.value).toBe('Away on a trip')
})

it('keeps the dates of an absence still to come, though the responder is off', async () => {
  const { field, turnOn } = await mount(0, AHEAD)
  await turnOn()
  expect(field('Starts')!.value).toContain('2099-06')
  expect(field('Ends (optional)')!.value).toContain('2099-06')
})

it('keeps the dates while the responder is on, over or not', async () => {
  const { field } = await mount(1, LONG_AGO)
  expect(field('Ends (optional)')!.value).toContain('2020-06')
})

it('shows the dates, subject and message only while the responder is on', async () => {
  const off = await mount(0, AHEAD)
  expect(off.field('Subject')).toBeNull()
  expect(off.field('Ends (optional)')).toBeNull()
  expect(off.root.querySelector('[data-message]')).toBeNull()

  const on = await mount(1, AHEAD)
  expect(on.field('Subject')).not.toBeNull()
  expect(on.root.querySelector('[data-message]')).not.toBeNull()
})
it('hands a refused save to the app, where failed saves are reported', async () => {
  const refusal = new Error('The dates are the wrong way round')
  run.mockRejectedValue(refusal)
  const { root } = await mount(1, AHEAD)
  root.querySelector<HTMLElement>('[label="Save"]')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(reported.mock.calls[0]?.[0]).toBe(refusal)
})
it('says why a save was refused on the form, in place of a toast', async () => {
  run.mockRejectedValue(new Error('The dates are the wrong way round'))
  const { root, turnOn } = await mount(0, AHEAD)
  await turnOn()
  root.querySelector<HTMLElement>('[label="Save"]')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(root.querySelector('[role="alert"]')?.textContent).toBe(
    'The dates are the wrong way round',
  )
  expect(failureToast).not.toHaveBeenCalled()
})
it('saves a picked time as UTC, and a date left alone as it was read', async () => {
  const { root, field } = await mount(1, AHEAD)
  const starts = requireTestElement(field('Starts'), HTMLInputElement)
  // What the date and time picker hands back: a clock reading, here in Kolkata, 5:30 ahead of UTC
  starts.value = '2099-07-01 09:00:00'
  starts.dispatchEvent(new Event('input'))
  await nextTick()
  root.querySelector<HTMLElement>('[label="Save"]')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ from_date: '2099-07-01T03:30:00Z', to_date: AHEAD.to }),
  )
})
it('reads a saved time to the minute, as the picker hands times back', async () => {
  const { field } = await mount(1, { from: '2099-06-01T09:00:45Z', to: AHEAD.to })
  expect(field('Starts')!.value).toBe('2099-06-01 14:30:00')
})
it('asks before turning on, in its own words, when that stops the rules', async () => {
  scripts.value = [{ _name: 'frappe_mail_automation', active: 1 }]
  const { root, turnOn } = await mount(0, AHEAD)
  await turnOn()
  root.querySelector<HTMLElement>('[label="Save"]')!.click()
  await nextTick()
  const question = requireTestElement(root.querySelector('[role="dialog"]'), HTMLElement)
  expect(question.querySelector('h2')?.textContent).toBe('Turn on auto-reply?')
  expect(question.querySelector('p')?.textContent).toContain('rules stop sorting mail')
  expect(run).not.toHaveBeenCalled()

  const [cancel, confirm] = Array.from(question.querySelectorAll('button'))
  expect(cancel.textContent).toBe('Cancel')
  expect(confirm.textContent).toBe('Turn on auto-reply')
  confirm.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  expect(root.querySelector('[role="dialog"]')).toBeNull()
})
it('saves nothing when the question is cancelled', async () => {
  scripts.value = [{ _name: 'frappe_mail_automation', active: 1 }]
  const { root, turnOn } = await mount(0, AHEAD)
  await turnOn()
  root.querySelector<HTMLElement>('[label="Save"]')!.click()
  await nextTick()
  root.querySelector<HTMLElement>('[role="dialog"] button')!.click()
  await nextTick()
  expect(root.querySelector('[role="dialog"]')).toBeNull()
  expect(run).not.toHaveBeenCalled()
})
