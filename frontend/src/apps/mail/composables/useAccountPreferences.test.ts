import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick, reactive } from 'vue'

import { useAccountPreferences } from './useAccountPreferences'

// SAFETY: the null and empty literals only seed the mock state; the tests fill them with these shapes.
const state = vi.hoisted(() => ({
  saved: null as { data: Record<string, unknown> | undefined } | null,
  store: null as { accountId: string } | null,
  sent: [] as unknown[],
  answers: [] as { resolve: () => void; reject: (error: Error) => void }[],
  feedback: vi.fn(),
}))

// The real write pipeline over a server that waits for the test: `answers[i]` answers the i-th
// request, in any order. Writes go one at a time, so each test answers what it left waiting.
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  const { createApiClient } = await import('@/platform/server-state')
  const request = vi.fn()
  request.mockImplementation((_operation: unknown, input: unknown) => {
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
    useMutation: engine.useMutation,
    useQuery: () => state.saved,
  }
})
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => state.store }))

function mount() {
  let preferences!: ReturnType<typeof useAccountPreferences>
  const app = createApp(
    defineComponent({
      setup() {
        preferences = useAccountPreferences()
        return () => null
      },
    }),
  )
  app.mount(document.createElement('div'))
  return { ...preferences, unmount: () => app.unmount() }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
/** The i-th request's answer, once that request is on its way. */
async function answer(i: number) {
  await vi.waitFor(() => expect(state.answers[i]).toBeDefined())
  return state.answers[i]!
}

beforeEach(() => {
  state.saved = reactive({
    data: { block_remote_images: 0, on_block_old_mail: 'Ask', default_outgoing_email: 'me@x.test' },
  })
  state.store = reactive({ accountId: 'personal' })
  state.sent = []
  state.answers = []
  state.feedback.mockReset()
})

afterEach(async () => {
  for (const pending of state.answers) pending.resolve()
  await settle()
})

it('shows a switch change at once and sends only that field', async () => {
  const { flag, setFlag } = mount()
  void setFlag('block_remote_images', true)
  expect(flag('block_remote_images')).toBe(true)
  await answer(0)
  expect(state.sent).toEqual([{ account: 'personal', changes: { block_remote_images: 1 } }])
})

it('puts the switch back when the save fails', async () => {
  const { flag, setFlag } = mount()
  const saving = setFlag('block_remote_images', true)
  ;(await answer(0)).reject(new Error('Server refused'))
  await saving
  expect(flag('block_remote_images')).toBe(false)
  expect(state.feedback).toHaveBeenCalledOnce()
})

it('keeps a select change once the save lands', async () => {
  const { preferences, save } = mount()
  const saving = save('on_block_old_mail', 'Keep')
  ;(await answer(0)).resolve()
  await saving
  expect(preferences.value?.on_block_old_mail).toBe('Keep')
})

it('shows what the server sends after a reload', async () => {
  const { preferences } = mount()
  state.saved!.data = { ...state.saved!.data, default_outgoing_email: 'alias@x.test' }
  await nextTick()
  await settle()
  expect(preferences.value?.default_outgoing_email).toBe('alias@x.test')
})

it('keeps the newer value when an older save of the same field fails', async () => {
  const { preferences, save } = mount()
  const first = save('on_block_old_mail', 'Keep')
  const second = save('on_block_old_mail', 'Move to Junk')
  ;(await answer(0)).reject(new Error('Server refused'))
  await first
  expect(preferences.value?.on_block_old_mail).toBe('Move to Junk')
  ;(await answer(1)).resolve()
  await second
  expect(preferences.value?.on_block_old_mail).toBe('Move to Junk')
})

it('goes back to what the server stores after two quick changes both fail', async () => {
  const { preferences, save } = mount()
  const first = save('on_block_old_mail', 'Keep')
  const second = save('on_block_old_mail', 'Move to Junk')
  ;(await answer(0)).reject(new Error('Server refused'))
  await first
  ;(await answer(1)).reject(new Error('Server refused'))
  await second
  expect(preferences.value?.on_block_old_mail).toBe('Ask')
})

it('sends only the changed field while another change is still on its way', async () => {
  const { save, setFlag } = mount()
  const first = setFlag('block_remote_images', true)
  const second = save('on_block_old_mail', 'Keep')
  ;(await answer(0)).reject(new Error('Server refused'))
  await first
  ;(await answer(1)).resolve()
  await second
  expect(state.sent[1]).toEqual({ account: 'personal', changes: { on_block_old_mail: 'Keep' } })
})

it('sends changes made before Settings closed to their account, not the one switched to', async () => {
  const { save, setFlag, unmount } = mount()
  const first = setFlag('block_remote_images', true)
  const second = save('on_block_old_mail', 'Keep')
  const firstAnswer = await answer(0)
  unmount()
  state.store!.accountId = 'work'
  firstAnswer.resolve()
  await first
  ;(await answer(1)).resolve()
  await second
  expect(state.sent).toEqual([
    { account: 'personal', changes: { block_remote_images: 1 } },
    { account: 'personal', changes: { on_block_old_mail: 'Keep' } },
  ])
})

it('still reports a change that fails after Settings closed', async () => {
  const { setFlag, unmount } = mount()
  const saving = setFlag('block_remote_images', true)
  const pending = await answer(0)
  unmount()
  pending.reject(new Error('Server refused'))
  await saving
  expect(state.feedback).toHaveBeenCalledOnce()
})
