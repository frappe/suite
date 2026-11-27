import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, reactive } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import MailRegionSettings from './MailRegionSettings.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const state = vi.hoisted(() => ({
  provider: true,
  inputs: new Map<string, () => unknown>(),
  account: { data: { block_remote_images: 0, destroy_email_after_submit: 0 } },
  regional: {
    data: { locale: 'en-US', time_zone: 'UTC', locales: [], time_zones: [] },
    error: fromPartial<Error | null>(null),
  },
  save: vi.fn(),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    userResource: { data: { is_suite_cloud_configured: state.provider } },
  }),
}))
vi.mock('@/apps/mail/utils/composables', () => ({ useScreenSize: () => ({ isMobile: false }) }))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  return {
    api: { mail: api },
    useQuery: (reference: { id: string }, input: () => unknown) => {
      state.inputs.set(reference.id, input)
      return reference.id === 'regional_preferences'
        ? reactive(state.regional)
        : reactive(state.account)
    },
    client: {
      mutation: (reference: { id: string }, input: unknown) => state.save(reference.id, input),
    },
  }
})
vi.mock('frappe-ui', () => ({
  // Declared props, so a mock reads its value however the page spells the binding
  Combobox: defineComponent({
    props: { modelValue: { type: String, default: '' } },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        h('input', {
          value: props.modelValue,
          onInput: (event: Event) =>
            emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
        })
    },
  }),
  ErrorMessage: defineComponent({
    setup(_, { attrs }) {
      return () => h('p', String(attrs.message ?? ''))
    },
  }),
  SettingsRow: defineComponent({
    setup(_, { attrs, slots }) {
      return () => h('label', [String(attrs.title), slots.default?.()])
    },
  }),
  SettingsHeader: defineComponent({
    setup(_, { slots }) {
      return () => h('header', slots.actions?.())
    },
  }),
  SettingsBody: defineComponent({
    setup(_, { slots }) {
      return () => h('main', slots.default?.())
    },
  }),
  Switch: defineComponent({
    props: { modelValue: Boolean },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        h('button', {
          role: 'switch',
          'aria-checked': String(props.modelValue),
          onClick: () => emit('update:modelValue', !props.modelValue),
        })
    },
  }),
}))
let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(MailRegionSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
  return root
}

/** The control of the row with this title. */
function control<T extends HTMLElement>(root: HTMLElement, title: string, kind: new () => T) {
  const row = Array.from(root.querySelectorAll('label')).find((label) =>
    label.textContent.startsWith(title),
  )
  return requireTestElement(row?.querySelector('input, button'), kind)
}

async function choose(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
beforeEach(() => {
  window.__ = (text: string) => text
  state.provider = true
  state.inputs.clear()
  state.account = { data: { block_remote_images: 0, destroy_email_after_submit: 0 } }
  state.regional = {
    data: { locale: 'en-US', time_zone: 'UTC', locales: [], time_zones: [] },
    error: null,
  }
  state.save.mockReset().mockResolvedValue(undefined)
})
afterEach(() => app.unmount())
it('neither requests nor shows the provider region on a site without a provider', () => {
  state.provider = false
  const root = mount()
  expect(state.inputs.get('regional_preferences')?.()).toBe(false)
  expect(root.textContent).not.toContain('Mail locale')
})
it('saves a regional choice as it is made, and shows what is read when the page opens again', async () => {
  const root = mount()
  expect(state.inputs.get('regional_preferences')?.()).toEqual({})
  await choose(control(root, 'Mail locale', HTMLInputElement), 'fr-FR')
  expect(state.save).toHaveBeenCalledWith('update_regional_preferences', {
    locale: 'fr-FR',
    time_zone: 'UTC',
  })
  app.unmount()
  state.regional.data = { locale: 'fr-FR', time_zone: 'Europe/Paris', locales: [], time_zones: [] }
  const reopened = mount()
  expect(control(reopened, 'Mail locale', HTMLInputElement).value).toBe('fr-FR')
  expect(control(reopened, 'Mail time zone', HTMLInputElement).value).toBe('Europe/Paris')
})
it('shows configured provider read failures', () => {
  state.regional.error = new Error('Provider unavailable')
  expect(mount().textContent).toContain('Provider unavailable')
})
it('puts a regional choice back when its save is refused', async () => {
  state.save.mockRejectedValue(new Error('Provider refused the update'))
  const root = mount()
  const locale = control(root, 'Mail locale', HTMLInputElement)
  await choose(locale, 'fr-FR')
  expect(state.save).toHaveBeenCalledTimes(1)
  expect(locale.value).toBe('en-US')
})
