import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createApiClient } from '@/platform/server-state'
import { createTransport } from '@/platform/transport'

import { useLobby } from './useLobby'
import { useLobbyStore } from './useLobbyStore'

const mocks = vi.hoisted(() => ({ mutation: vi.fn<typeof import('@/api').client.mutation>() }))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  client: { mutation: mocks.mutation },
}))
const fetcher = vi.fn<typeof fetch>()
const feedback = vi.fn()
let engine: ReturnType<typeof createApiClient>
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  engine = createApiClient(
    { meet: () => import('@/apps/meet/client/policy').then((m) => m.registration) },
    { transport: createTransport({ fetch: fetcher, maxRetries: 0 }), persistence: false, feedback },
  )
  mocks.mutation.mockImplementation(engine.client.mutation)
})
afterEach(() => engine.dispose())
it.each(['approveUser', 'approveAllUsers', 'rejectUser'] as const)(
  'keeps waiting participants when %s is refused and updates them only after a successful retry',
  async (action) => {
    let respond: (response: Response) => void = () => {}
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve
        }),
    )
    const store = useLobbyStore()
    store.setLobbyUsers([
      { userId: 'alice', name: 'Alice' },
      { userId: 'bob', name: 'Bob' },
    ])
    const lobby = useLobby({ lobbyStore: store, meetingId: 'room-1' })
    const refused = lobby[action]('alice')
    const rejection = expect(refused).rejects.toMatchObject({ status: 403 })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    expect(store.lobbyUsers.map((user) => user.userId)).toEqual(['alice', 'bob'])
    respond(
      new Response(
        JSON.stringify({
          errors: [
            { type: 'PermissionError', message: 'Only hosts can manage waiting participants' },
          ],
        }),
        { status: 403 },
      ),
    )
    await rejection
    expect(store.lobbyUsers.map((user) => user.userId)).toEqual(['alice', 'bob'])
    expect(feedback).toHaveBeenCalledOnce()
    fetcher.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({ data: { meeting_id: 'room-1', message: 'Updated', user_id: 'alice' } }),
        ),
    )
    await lobby[action]('alice')
    expect(store.lobbyUsers.map((user) => user.userId)).toEqual(
      action === 'approveAllUsers' ? [] : ['bob'],
    )
    expect(feedback).toHaveBeenCalledOnce()
  },
)
