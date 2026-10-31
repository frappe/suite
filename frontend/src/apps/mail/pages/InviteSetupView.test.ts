import { expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import InviteSetupView from './InviteSetupView.vue'

const run = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/apps/mail/stores/session', () => ({ sessionStore: () => ({ login: vi.fn() }) }))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  return {
    api: { mail: api },
    useMutation: () => ({ run }),
    useQuery: (reference: { id: string }) => ({
      data:
        reference.id === 'get_account_request'
          ? { account: 'person@example.test', is_verified: false, is_expired: false }
          : { locales: [{ value: 'en-US' }], time_zones: [{ value: 'UTC' }] },
    }),
  }
})
vi.mock('frappe-ui', () => ({
  FormControl: defineComponent({
    setup(_, { attrs }) {
      return () => h('input', { 'aria-label': attrs.label })
    },
  }),
  Button: defineComponent({
    setup(_, { attrs }) {
      return () => h('button', attrs, String(attrs.label))
    },
  }),
  ErrorMessage: defineComponent({ render: () => null }),
}))
it('completes signup and invitations without asking for regional preferences', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  const resolved = Intl.DateTimeFormat().resolvedOptions()
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...resolved,
    timeZone: 'UTC',
  })
  const host = document.createElement('div')
  const app = createApp(InviteSetupView, { requestKey: 'a'.repeat(32) })
  app.config.globalProperties.__ = (value: string) => value
  app.component('RouterLink', defineComponent({ render: () => null }))
  app.mount(host)
  try {
    expect(
      Array.from(host.querySelectorAll('input')).map((input) => input.getAttribute('aria-label')),
    ).toEqual(['Email', 'First Name', 'Last Name', 'Password'])
    host.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await nextTick()
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en-US', time_zone: 'UTC' }))
  } finally {
    app.unmount()
    vi.restoreAllMocks()
  }
})
