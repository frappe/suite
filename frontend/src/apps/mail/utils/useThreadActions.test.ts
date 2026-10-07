import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, effectScope, reactive, ref } from 'vue'

import { createApiClient } from '@/platform/server-state'
import { createTransport } from '@/platform/transport'

import { useThreadActions } from './useThreadActions'

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn<typeof import('@/api').useMutation>(),
}))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useMutation: mocks.useMutation,
}))
vi.mock('@/apps/mail/composables/useComposeWindow', () => ({ closeComposeWindowFor: vi.fn() }))
vi.mock('@/apps/mail/utils', () => ({
  getIcon: vi.fn(),
  raiseOptimisticToast: vi.fn(),
  raisePromiseToast: vi.fn(),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useUndo: () => ({ setUndoAction: vi.fn(), undo: vi.fn() }),
  useBlockSender: () => ({ promptBlockSenders: vi.fn(), willJunkSenders: vi.fn() }),
}))
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => store }))

const store = reactive({
  accountId: 'account-a',
  mailboxes: { data: [], refetch: vi.fn() },
  mailboxIds: { inbox: 'inbox', sent: 'sent', drafts: 'drafts', junk: 'junk', trash: 'trash' },
})
const fetcher = vi.fn<typeof fetch>()
const feedback = vi.fn()
let engine: ReturnType<typeof createApiClient>
let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  vi.clearAllMocks()
  store.accountId = 'account-a'
  scope = effectScope()
  engine = createApiClient(
    { mail: () => import('@/apps/mail/client/policy').then((module) => module.registration) },
    { transport: createTransport({ fetch: fetcher, maxRetries: 0 }), persistence: false, feedback },
  )
  mocks.useMutation.mockImplementation(engine.useMutation)
})
afterEach(() => {
  scope.stop()
  engine.dispose()
})

it('stars reading-pane messages in the current account and permits retry after refusal', async () => {
  const actions = scope.run(() =>
    useThreadActions({
      rows: computed(() => []),
      mailbox: computed(() => 'inbox'),
      threadID: computed(() => 'thread'),
      selections: ref([]),
      mailThreadRef: ref(null),
      resetThreads: vi.fn(),
      syncAfterAction: vi.fn(),
      removeThreadsFromList: () => [],
      restoreThreadsToList: vi.fn(),
      refillIfEmpty: vi.fn(),
      goToMailbox: vi.fn(),
      goToNextThreadOrMailbox: vi.fn(),
    }),
  )!
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ errors: [{ type: 'PermissionError', message: 'Access refused' }] }),
      { status: 403 },
    ),
  )
  await expect(actions.setFlaggedSubmit({ ids: ['message'], flagged: true })).rejects.toMatchObject(
    {
      status: 403,
    },
  )
  expect(feedback).toHaveBeenCalledOnce()
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    account: 'account-a',
    ids: ['message'],
    flagged: true,
  })

  store.accountId = 'account-b'
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: { ids: ['message'], flagged: false } })),
  )
  await expect(
    actions.setFlaggedSubmit({ ids: ['message'], flagged: false }),
  ).resolves.toBeUndefined()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(String(fetcher.mock.calls[1][0])).toContain('/suite.mail.api.mail.set_flagged')
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    account: 'account-b',
    ids: ['message'],
    flagged: false,
  })
  expect(feedback).toHaveBeenCalledOnce()
})
