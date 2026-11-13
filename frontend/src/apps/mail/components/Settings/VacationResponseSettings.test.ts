import { beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import VacationResponseSettings from './VacationResponseSettings.vue'

const saved = vi.hoisted<{ value: Record<string, unknown> | null }>(() => ({ value: null }))

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
    Switch: passthrough,
    // A field shows what it was handed: its label, its value and whether it can be edited.
    FormControl: defineComponent({
      inheritAttrs: false,
      setup(_props, { attrs }) {
        return () =>
          h('input', {
            'data-label': attrs.label,
            value: attrs.modelValue,
            disabled: attrs.disabled,
          })
      },
    }),
  }
})
vi.mock('@/api', () => ({
  api: { mail: { vacation: { get: {}, update: {} } } },
  useQuery: () => ({ data: saved.value }),
  useMutation: () => ({ run: vi.fn(), loading: false }),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ accountId: 'account', sieveScripts: { data: [] } }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
// The message box shows only whether it can be edited.
vi.mock('@/apps/mail/components/Controls/MailRichTextField.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: { editable: { type: Boolean, default: true } },
      setup: (props) => () => h('div', { 'data-editable': String(props.editable) }),
    }),
  }
})
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
  app.mount(root)
  await nextTick()
  const field = (label: string) => root.querySelector<HTMLInputElement>(`[data-label="${label}"]`)!
  return { field, editor: root.querySelector('[data-editable]')! }
}

beforeEach(() => {
  window.__ = (message: string) => message
})

it('starts from no dates once an absence is off and over, keeping its words', async () => {
  const { field } = await mount(0, LONG_AGO)
  expect(field('From Date').value).toBe('')
  expect(field('To Date').value).toBe('')
  expect(field('Subject').value).toBe('Away on a trip')
})

it('keeps the dates of an absence still to come, though the responder is off', async () => {
  const { field } = await mount(0, AHEAD)
  expect(field('From Date').value).toContain('2099-06')
  expect(field('To Date').value).toContain('2099-06')
})

it('keeps the dates while the responder is on, over or not', async () => {
  const { field } = await mount(1, LONG_AGO)
  expect(field('To Date').value).toContain('2020-06')
})

it('lets nothing be edited while the responder is off', async () => {
  const off = await mount(0, AHEAD)
  expect(off.field('Subject').disabled).toBe(true)
  expect(off.field('To Date').disabled).toBe(true)
  expect(off.editor.getAttribute('data-editable')).toBe('false')

  const on = await mount(1, AHEAD)
  expect(on.field('Subject').disabled).toBe(false)
  expect(on.editor.getAttribute('data-editable')).toBe('true')
})
