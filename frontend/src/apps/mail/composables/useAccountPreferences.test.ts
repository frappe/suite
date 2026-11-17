import { beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick, reactive } from 'vue'

import { useAccountPreferences } from './useAccountPreferences'

// SAFETY: the null and empty literals only seed the mock state; the tests fill them with these shapes.
const state = vi.hoisted(() => ({
  saved: null as { data: Record<string, unknown> | undefined } | null,
  sent: [] as unknown[],
  answers: [] as { resolve: () => void; reject: (error: Error) => void }[],
}))

vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  return {
    api: { mail: api },
    useQuery: () => state.saved,
    // Each save waits for the test to answer it, in any order: `answers[i]` answers the i-th save.
    useMutation: () => ({
      run: (input: unknown) => {
        state.sent.push(input)
        return new Promise<void>((resolve, reject) => {
          state.answers.push({ resolve, reject })
        })
      },
    }),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => ({ accountId: 'personal' }) }))

function mount() {
  let preferences!: ReturnType<typeof useAccountPreferences>
  createApp(
    defineComponent({
      setup() {
        preferences = useAccountPreferences()
        return () => null
      },
    }),
  ).mount(document.createElement('div'))
  return preferences
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  state.saved = reactive({
    data: { block_remote_images: 0, on_block_old_mail: 'Ask', default_outgoing_email: 'me@x.test' },
  })
  state.sent = []
  state.answers = []
})

it('shows a switch change at once and sends only that field', () => {
  const { flag, setFlag } = mount()
  void setFlag('block_remote_images', true)
  expect(flag('block_remote_images')).toBe(true)
  expect(state.sent).toEqual([{ account: 'personal', changes: { block_remote_images: 1 } }])
})

it('puts the switch back when the save fails', async () => {
  const { flag, setFlag } = mount()
  const saving = setFlag('block_remote_images', true)
  state.answers[0]!.reject(new Error('Server refused'))
  await saving
  expect(flag('block_remote_images')).toBe(false)
})

it('keeps a select change once the save lands', async () => {
  const { preferences, save } = mount()
  const saving = save('on_block_old_mail', 'Keep')
  state.answers[0]!.resolve()
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
  state.answers[0]!.reject(new Error('Server refused'))
  await first
  expect(preferences.value?.on_block_old_mail).toBe('Move to Junk')
  state.answers[1]!.resolve()
  await second
  expect(preferences.value?.on_block_old_mail).toBe('Move to Junk')
})

it('goes back to what the server stores after two quick changes both fail', async () => {
  const { preferences, save } = mount()
  const first = save('on_block_old_mail', 'Keep')
  const second = save('on_block_old_mail', 'Move to Junk')
  state.answers[0]!.reject(new Error('Server refused'))
  await first
  state.answers[1]!.reject(new Error('Server refused'))
  await second
  expect(preferences.value?.on_block_old_mail).toBe('Ask')
})

it('sends only the changed field while another change is still on its way', async () => {
  const { save, setFlag } = mount()
  const first = setFlag('block_remote_images', true)
  const second = save('on_block_old_mail', 'Keep')
  state.answers[0]!.reject(new Error('Server refused'))
  await first
  await settle()
  expect(state.sent[1]).toEqual({ account: 'personal', changes: { on_block_old_mail: 'Keep' } })
  state.answers[1]!.resolve()
  await second
})
