import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import MailGeneralSettings from './MailGeneralSettings.vue'

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
vi.mock('@/apps/mail/composables/useQuota', () => ({ useQuota: () => ({}) }))
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
  app = createApp(MailGeneralSettings)
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
it('saves a switch as it is flipped, sending only that preference', async () => {
  const root = mount()
  const remoteImages = control(root, 'Block remote images', HTMLButtonElement)
  expect(remoteImages.getAttribute('aria-checked')).toBe('false')
  remoteImages.click()
  await nextTick()
  expect(remoteImages.getAttribute('aria-checked')).toBe('true')
  expect(state.save).toHaveBeenCalledWith('update_account_preferences', {
    account: 'personal',
    changes: { block_remote_images: 1 },
  })
})
it('puts a switch back when its save is refused', async () => {
  state.save.mockRejectedValue(new Error('Server refused the update'))
  const root = mount()
  const sentMail = control(root, 'Don’t keep sent mail', HTMLButtonElement)
  sentMail.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.save).toHaveBeenCalledTimes(1)
  expect(sentMail.getAttribute('aria-checked')).toBe('false')
})
it('neither requests nor shows the provider region on a site without a provider', () => {
  state.provider = false
  const root = mount()
  expect(state.inputs.get('regional_preferences')?.()).toBe(false)
  expect(root.textContent).not.toContain('Locale')
  expect(root.textContent).toContain('Block remote images')
})
it('saves a regional choice as it is made, and shows the saved one on reopen', async () => {
  const root = mount()
  expect(state.inputs.get('regional_preferences')?.()).toEqual({})
  await choose(control(root, 'Locale', HTMLInputElement), 'fr-FR')
  expect(state.save).toHaveBeenCalledWith('update_regional_preferences', {
    locale: 'fr-FR',
    time_zone: 'UTC',
  })
  app.unmount()
  state.regional.data = { locale: 'fr-FR', time_zone: 'Europe/Paris', locales: [], time_zones: [] }
  const reopened = mount()
  expect(control(reopened, 'Locale', HTMLInputElement).value).toBe('fr-FR')
  expect(control(reopened, 'Time zone', HTMLInputElement).value).toBe('Europe/Paris')
})
it('shows configured provider read failures', () => {
  state.regional.error = new Error('Provider unavailable')
  expect(mount().textContent).toContain('Provider unavailable')
})
it('keeps a later regional choice when the read after an earlier save lands', async () => {
  const saves: Array<() => void> = []
  state.save.mockImplementation(() => new Promise<void>((resolve) => saves.push(resolve)))
  const root = mount()
  await choose(control(root, 'Locale', HTMLInputElement), 'fr-FR')
  await choose(control(root, 'Time zone', HTMLInputElement), 'Europe/Paris')
  // The first save is answered and its read lands, from before the time zone was chosen
  saves[0]?.()
  reactive(state.regional).data = { locale: 'fr-FR', time_zone: 'UTC', locales: [], time_zones: [] }
  await nextTick()
  expect(control(root, 'Time zone', HTMLInputElement).value).toBe('Europe/Paris')
  await choose(control(root, 'Locale', HTMLInputElement), 'de-DE')
  expect(state.save).toHaveBeenLastCalledWith('update_regional_preferences', {
    locale: 'de-DE',
    time_zone: 'Europe/Paris',
  })
})
it('puts a regional choice back when its save is refused', async () => {
  state.save.mockRejectedValue(new Error('Provider refused the update'))
  const root = mount()
  const locale = control(root, 'Locale', HTMLInputElement)
  await choose(locale, 'fr-FR')
  expect(state.save).toHaveBeenCalledTimes(1)
  expect(locale.value).toBe('en-US')
})
