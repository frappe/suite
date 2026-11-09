import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, effectScope, reactive, ref } from 'vue'

import type { Thread } from '@/apps/mail/types'
import { createApiClient } from '@/platform/server-state'
import { createTransport } from '@/platform/transport'

import { useThreadActions } from './useThreadActions'

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn<typeof import('@/api').useMutation>(),
  mutation: vi.fn(),
  holdDraft: vi.fn(),
  raiseOptimisticToast: vi.fn(),
  setUndoAction: vi.fn(),
}))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useMutation: mocks.useMutation,
  client: { mutation: mocks.mutation },
}))
vi.mock('@/apps/mail/composables/useComposeWindow', () => ({ closeComposeWindowFor: vi.fn() }))
vi.mock('@/apps/mail/utils', () => ({
  getIcon: vi.fn(),
  raiseOptimisticToast: mocks.raiseOptimisticToast,
  raisePromiseToast: vi.fn(),
  commitAfterUndo: vi.fn(),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useUndo: () => ({ setUndoAction: mocks.setUndoAction, undo: vi.fn() }),
  useDiscardingDrafts: () => ({ holdDraft: mocks.holdDraft, releaseDraft: vi.fn() }),
}))
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => store }))

const store = reactive({
  accountId: 'account-a',
  mailboxes: { data: [], refetch: vi.fn(() => Promise.resolve()) },
  mailboxIds: {
    inbox: 'inbox',
    sent: 'sent',
    drafts: 'drafts',
    junk: 'junk',
    trash: 'trash',
    snoozed: '',
  },
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
    { transport: createTransport({ fetch: fetcher, maxRetries: 0 }), feedback },
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

it('undoing an unsnooze waits again for the time each conversation had, not just the folder', async () => {
  const snoozed = {
    thread_id: 't1',
    messages: [{ id: 'm1', name: 'm1', draft: 0, junk: 0, mailboxes: [{ mailbox_id: 'snoozed' }] }],
  }
  const restoreThreadsToList = vi.fn()
  store.mailboxIds.snoozed = 'snoozed'
  const actions = scope.run(() =>
    useThreadActions({
      rows: computed(() => [fromPartial<Thread>(snoozed)]),
      mailbox: computed(() => 'snoozed'),
      threadID: computed(() => undefined),
      selections: ref([]),
      mailThreadRef: ref(null),
      resetThreads: vi.fn(),
      syncAfterAction: vi.fn(),
      removeThreadsFromList: () => [fromPartial<Thread>(snoozed)],
      restoreThreadsToList,
      refillIfEmpty: vi.fn(),
      goToMailbox: vi.fn(),
      goToNextThreadOrMailbox: vi.fn(),
    }),
  )!
  const waited = [{ until: '2026-11-20T03:30:00Z', ids: ['m1'] }]
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: { updated: ['m1'], left_inbox: false, waited } })),
  )
  mocks.mutation.mockResolvedValue({ updated: ['m1'], left_inbox: true })

  vi.stubGlobal('__', (text: string) => text)
  await actions.unsnoozeThreads(['t1'])
  const undo = mocks.setUndoAction.mock.calls.findLast(([action]) => action)![0]
  undo()
  await vi.waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce())
  vi.unstubAllGlobals()

  expect(mocks.mutation.mock.calls[0][1]).toEqual({
    account: 'account-a',
    ids: ['m1'],
    until: '2026-11-20T03:30:00Z',
    leaves: null,
  })
  expect(restoreThreadsToList).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledOnce()
})

it('discarding a reply draft from the list holds only the draft, not the mail it answers', () => {
  const conversation = {
    thread_id: 't1',
    messages: [
      { id: 'original', name: 'original', draft: 0, mailboxes: [{ mailbox_id: 'inbox' }] },
      { id: 'reply', name: 'reply', draft: 1, mailboxes: [{ mailbox_id: 'drafts' }] },
    ],
  }
  const actions = scope.run(() =>
    useThreadActions({
      rows: computed(() =>
        fromPartial<Parameters<typeof useThreadActions>[0]['rows']['value']>([conversation]),
      ),
      mailbox: computed(() => 'drafts'),
      threadID: computed(() => undefined),
      selections: ref([]),
      mailThreadRef: ref(null),
      resetThreads: vi.fn(),
      syncAfterAction: vi.fn(),
      removeThreadsFromList: () => fromPartial([conversation]),
      restoreThreadsToList: vi.fn(),
      refillIfEmpty: vi.fn(),
      goToMailbox: vi.fn(),
      goToNextThreadOrMailbox: vi.fn(),
    }),
  )!

  vi.stubGlobal('__', (text: string) => text)
  actions.junkOrDeleteThreads(['t1'], false)
  vi.unstubAllGlobals()

  expect(mocks.holdDraft.mock.calls.map(([id]) => id)).toEqual(['reply'])
})

const archiveFrom = (mailbox: string) => {
  const message = { id: 'm1', name: 'm1', draft: 0, junk: 0, mailboxes: [{ mailbox_id: mailbox }] }
  const conversation = { ...message, thread_id: 't1', messages: [message] }
  return scope.run(() =>
    useThreadActions({
      rows: computed(() => [fromPartial<Thread>(conversation)]),
      mailbox: computed(() => mailbox),
      threadID: computed(() => undefined),
      selections: ref([]),
      mailThreadRef: ref(null),
      resetThreads: vi.fn(),
      syncAfterAction: vi.fn(),
      removeThreadsFromList: () => [fromPartial<Thread>(conversation)],
      restoreThreadsToList: vi.fn(),
      refillIfEmpty: vi.fn(),
      goToMailbox: vi.fn(),
      goToNextThreadOrMailbox: vi.fn(),
    }),
  )!
}

// raiseOptimisticToast says a plain message on the click, and waits for the answer to work out one
// it has to read off it.
it('names an archive out of the Inbox outright, so its toast can come with the click', () => {
  fetcher.mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('__', (text: string) => text)
  archiveFrom('inbox').handleArchiveThreads(['t1'])
  vi.unstubAllGlobals()

  expect(mocks.raiseOptimisticToast.mock.calls.at(-1)?.[1]).toBe('Thread archived.')
})

it('leaves the toast to the answer when archiving from a list the row stays on', () => {
  fetcher.mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('__', (text: string) => text)
  archiveFrom('a-folder').handleArchiveThreads(['t1'])
  const told = mocks.raiseOptimisticToast.mock.calls.at(-1)?.[1]
  expect(told({ left_inbox: false })).toBe('Added to Archive.')
  expect(told({ left_inbox: true })).toBe('Thread archived.')
  vi.unstubAllGlobals()
})
