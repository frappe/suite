import { beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import VacationResponseSettings from './VacationResponseSettings.vue'

const saved = vi.hoisted<{ value: Record<string, unknown> | null }>(() => ({ value: null }))
const run = vi.hoisted(() => vi.fn())
const reported = vi.hoisted(() => vi.fn())

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
    // A field shows what it was handed: its label and its value
    FormControl: defineComponent({
      inheritAttrs: false,
      setup(_props, { attrs }) {
        return () =>
          h('input', {
            'data-label': attrs.label,
            value: attrs.modelValue,
          })
      },
    }),
  }
})
vi.mock('@/api', () => ({
  api: { mail: { vacation: { get: {}, update: {} } } },
  useQuery: () => ({ data: saved.value }),
  useMutation: () => ({ run, loading: false }),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ accountId: 'account', sieveScripts: { data: [] } }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
vi.mock('@/apps/mail/components/Controls/MailRichTextField.vue', () => ({
  default: { render: () => h('div', { 'data-message': '' }) },
}))
vi.mock('@/apps/mail/components/Modals/SetSieveScriptStateModal.vue', () => ({
  default: { render: () => null },
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
})

it('starts from no dates once an absence is off and over, keeping its words', async () => {
  const { field, turnOn } = await mount(0, LONG_AGO)
  await turnOn()
  expect(field('From date')!.value).toBe('')
  expect(field('To date')!.value).toBe('')
  expect(field('Subject')!.value).toBe('Away on a trip')
})

it('keeps the dates of an absence still to come, though the responder is off', async () => {
  const { field, turnOn } = await mount(0, AHEAD)
  await turnOn()
  expect(field('From date')!.value).toContain('2099-06')
  expect(field('To date')!.value).toContain('2099-06')
})

it('keeps the dates while the responder is on, over or not', async () => {
  const { field } = await mount(1, LONG_AGO)
  expect(field('To date')!.value).toContain('2020-06')
})

it('shows the dates, subject and message only while the responder is on', async () => {
  const off = await mount(0, AHEAD)
  expect(off.field('Subject')).toBeNull()
  expect(off.field('To date')).toBeNull()
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
