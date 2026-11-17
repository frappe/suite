import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, reactive, type Component } from 'vue'

import { mailSettings } from '@/apps/mail/settings'

type Preferences = Record<string, unknown>

// SAFETY: the empty literals only seed the mock state; each test fills them.
const state = vi.hoisted(() => ({
  // The server's copy per account; an account missing here has not loaded.
  stored: {} as Record<string, Preferences | undefined>,
  store: { accountId: '', userResource: { data: {} } },
  sent: [] as unknown[],
  answers: [] as { resolve: () => void; reject: (error: Error) => void }[],
  feedback: vi.fn(),
  save: null as ((field: string, value: unknown) => Promise<void>) | null,
}))

// The real write pipeline over a server that waits for the test: `answers[i]` answers the i-th
// request. A read gives the stored copy of the account it asks for.
vi.mock('@/api', async () => {
  const { reactive } = await import('vue')
  const { api } = await import('@/apps/mail/client/generated')
  const { createApiClient } = await import('@/platform/server-state')
  const request = vi.fn((_operation: unknown, input: unknown) => {
    state.sent.push(input)
    return new Promise<void>((resolve, reject) => state.answers.push({ resolve, reject }))
  })
  const engine = createApiClient(
    { mail: async () => ({ policy: () => ({ staleTime: 0, effects: 'none' as const }) }) },
    { transport: { request }, feedback: state.feedback },
  )
  return {
    api: { mail: api },
    client: engine.client,
    useQuery: (_operation: unknown, input: () => { account: string } | false) =>
      reactive({
        get data() {
          const args = input()
          return args ? state.stored[args.account] : undefined
        },
      }),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => state.store }))
vi.mock('@/apps/mail/socket', () => ({ initSocket: vi.fn() }))
vi.mock('@/platform/session', () => ({
  useSession: () => ({ capabilities: { value: { jmap: true } } }),
}))
vi.mock('@/platform/settings-tab', async () => {
  const { useSavedFields } = await import('@/platform/settings-tab/useSavedFields')
  return { SettingsPage: { render: () => null }, useSavedFields }
})
// A Screener tab that shows the preferences it holds and hands its save to the test.
vi.mock('@/apps/mail/components/Settings/ScreenerSettings.vue', async () => {
  const { defineComponent, h } = await import('vue')
  const { useAccountPreferences } = await import('@/apps/mail/composables/useAccountPreferences')
  return {
    default: defineComponent({
      setup() {
        const { preferences, save } = useAccountPreferences()
        state.save = (field, value) => save(field as 'on_block_old_mail', value as string)
        return () => h('output', JSON.stringify(preferences.value ?? null))
      },
    }),
  }
})

const PERSONAL = { block_remote_images: 0, on_block_old_mail: 'Ask' }
const WORK = { block_remote_images: 1, on_block_old_mail: 'Move to Junk' }

async function mountScreener() {
  const tab = mailSettings.tabs.find((candidate) => candidate.id === 'mail.screener')!
  const Body: Component = await tab.body()
  const root = document.createElement('div')
  const app = createApp(Body)
  app.mount(root)
  await nextTick()
  return { shown: () => JSON.parse(root.textContent || 'null'), close: () => app.unmount() }
}
const save = (field: string, value: unknown) => state.save!(field, value)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
async function answer(i: number) {
  await vi.waitFor(() => expect(state.answers[i]).toBeDefined())
  return state.answers[i]!
}

beforeEach(() => {
  state.stored = reactive({ personal: { ...PERSONAL } })
  state.store = reactive({ accountId: 'personal', userResource: { data: {} } })
  state.sent = []
  state.answers = []
  state.feedback.mockReset()
})

afterEach(async () => {
  for (const pending of state.answers) pending.resolve()
  await settle()
})

it('shows the new account its own preferences while the old one still saves', async () => {
  state.stored.work = { ...WORK }
  const { shown } = await mountScreener()
  const first = save('block_remote_images', 1)
  const second = save('on_block_old_mail', 'Keep')
  const firstAnswer = await answer(0)

  state.store.accountId = 'work'
  await nextTick()
  expect(shown()).toEqual(WORK)

  firstAnswer.resolve()
  await first
  ;(await answer(1)).resolve()
  await second
  expect(state.sent).toEqual([
    { account: 'personal', changes: { block_remote_images: 1 } },
    { account: 'personal', changes: { on_block_old_mail: 'Keep' } },
  ])
  expect(shown()).toEqual(WORK)
})

it('still sends a queued change after the account switches and Settings closes', async () => {
  const { close } = await mountScreener()
  const first = save('block_remote_images', 1)
  const second = save('on_block_old_mail', 'Keep')
  const firstAnswer = await answer(0)

  state.store.accountId = 'work'
  await nextTick()
  close()
  firstAnswer.resolve()
  await first
  ;(await answer(1)).reject(new Error('Server refused'))
  await second
  expect(state.sent).toEqual([
    { account: 'personal', changes: { block_remote_images: 1 } },
    { account: 'personal', changes: { on_block_old_mail: 'Keep' } },
  ])
  expect(state.feedback).toHaveBeenCalledOnce()
})
