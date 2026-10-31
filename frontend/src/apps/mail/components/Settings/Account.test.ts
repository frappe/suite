import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import Account from './Account.vue'

const state = vi.hoisted(() => ({
  provider: true,
  inputs: new Map<string, () => unknown>(),
  regional: {
    data: { locale: 'en-US', time_zone: 'UTC', locales: [], time_zones: [] },
    error: null as Error | null,
  },
  save: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    identities: { data: [] },
    userResource: { data: { is_suite_cloud_configured: state.provider } },
  }),
}))
vi.mock('@/apps/mail/composables/useQuota', () => ({ useQuota: () => ({}) }))
vi.mock('@/apps/mail/utils/composables', () => ({ useScreenSize: () => ({ isMobile: false }) }))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: state.toast }))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  return {
    api: { mail: api },
    useQuery: (reference: { id: string }, input: () => unknown) => {
      state.inputs.set(reference.id, input)
      return reference.id === 'regional_preferences'
        ? reactive(state.regional)
        : { data: { default_outgoing_email: 'me@example.test' } }
    },
    useMutation: (reference: { id: string }) => {
      const result = reactive({
        error: null as Error | null,
        isPending: false,
        run: async (input: unknown) => {
          try {
            await state.save(reference.id, input)
          } catch (error) {
            result.error = error as Error
            throw error
          }
        },
      })
      return result
    },
  }
})
vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    setup(_, { attrs }) {
      return () => h('button', attrs, String(attrs.label))
    },
  }),
  Combobox: defineComponent({
    setup(_, { attrs }) {
      return () =>
        h('input', {
          value: attrs.modelValue,
          onInput: (event: Event) =>
            (attrs['onUpdate:modelValue'] as (value: string) => void)(
              (event.target as HTMLInputElement).value,
            ),
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
  Select: defineComponent({ render: () => null }),
  Switch: defineComponent({ render: () => null }),
}))
let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(Account)
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
  return root
}
beforeEach(() => {
  window.__ = (text: string) => text
  state.provider = true
  state.inputs.clear()
  state.regional = {
    data: { locale: 'en-US', time_zone: 'UTC', locales: [], time_zones: [] },
    error: null,
  }
  state.save.mockReset().mockResolvedValue(undefined)
  state.toast.mockReset()
})
afterEach(() => app.unmount())
it('preserves standalone settings without requesting or showing provider preferences', async () => {
  state.provider = false
  const root = mount()
  expect(state.inputs.get('regional_preferences')?.()).toBe(false)
  expect(root.textContent).not.toContain('Locale')
  expect(root.textContent).toContain('Outgoing')
  expect(root.querySelector('input')?.value).toBe('me@example.test')
  const outgoing = root.querySelector('input')!
  outgoing.value = 'alias@example.test'
  outgoing.dispatchEvent(new Event('input'))
  await nextTick()
  root.querySelector('button')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.save).toHaveBeenCalledWith('update_account_preferences', {
    account: 'personal',
    changes: { default_outgoing_email: 'alias@example.test' },
  })
  expect(state.save).not.toHaveBeenCalledWith('update_regional_preferences', expect.anything())
})
it('saves regional choices and displays the server response on reopen', async () => {
  const root = mount()
  expect(state.inputs.get('regional_preferences')?.()).toEqual({})
  const locale = root.querySelector('input')!
  locale.value = 'fr-FR'
  locale.dispatchEvent(new Event('input'))
  await nextTick()
  root.querySelector('button')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.save).toHaveBeenCalledWith('update_regional_preferences', {
    locale: 'fr-FR',
    time_zone: 'UTC',
  })
  app.unmount()
  state.regional.data = { locale: 'fr-FR', time_zone: 'Europe/Paris', locales: [], time_zones: [] }
  expect(
    Array.from(mount().querySelectorAll('input'))
      .slice(0, 2)
      .map((input) => input.value),
  ).toEqual(['fr-FR', 'Europe/Paris'])
})
it('shows configured provider read failures', () => {
  state.regional.error = new Error('Provider unavailable')
  expect(mount().textContent).toContain('Provider unavailable')
})
it('retains a refused save and reports no success', async () => {
  state.save.mockRejectedValue(new Error('Provider refused the update'))
  const root = mount()
  const locale = root.querySelector('input')!
  locale.value = 'fr-FR'
  locale.dispatchEvent(new Event('input'))
  await nextTick()
  root.querySelector('button')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(root.textContent).toContain('Provider refused the update')
  expect(locale.value).toBe('fr-FR')
  expect(state.toast).not.toHaveBeenCalled()
})
