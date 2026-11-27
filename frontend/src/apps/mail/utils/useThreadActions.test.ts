import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, reactive, ref } from 'vue'

import type { Thread } from '@/apps/mail/types'
import { createApiClient } from '@/platform/server-state'
import { createTransport } from '@/platform/transport'

import { deleteForeverOptions, useThreadActions } from './useThreadActions'

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn<typeof import('@/api').useMutation>(),
  mutation: vi.fn(),
  holdDraft: vi.fn(),
  setUndoAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))
vi.mock('frappe-ui', async (original) => ({
  ...(await original<typeof import('frappe-ui')>()),
  toast: mocks.toast,
}))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useMutation: mocks.useMutation,
  client: { mutation: mocks.mutation },
}))
vi.mock('@/apps/mail/composables/useComposeWindow', () => ({ closeComposeWindowFor: vi.fn() }))
vi.mock('@/apps/mail/utils', async (original) => ({
  ...(await original<typeof import('@/apps/mail/utils')>()),
  getIcon: vi.fn(),
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
  // The translator echoes its message, so the words the reader sees are the ones checked.
  vi.stubGlobal('__', (message: string, args?: (string | number)[]) =>
    args ? message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])) : message,
  )
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
  vi.unstubAllGlobals()
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

  await actions.unsnoozeThreads(['t1'])
  const undo = mocks.setUndoAction.mock.calls.findLast(([action]) => action)![0]
  undo()
  await vi.waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce())

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

  actions.junkOrDeleteThreads(['t1'], false)

  expect(mocks.holdDraft.mock.calls.map(([id]) => id)).toEqual(['reply'])
})

const archiveFrom = (mailbox: string, restoreThreadsToList = vi.fn()) => {
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
      restoreThreadsToList,
      refillIfEmpty: vi.fn(),
      goToMailbox: vi.fn(),
      goToNextThreadOrMailbox: vi.fn(),
    }),
  )!
}

const answer = (filed: { updated: string[]; left_inbox: boolean }) =>
  new Response(JSON.stringify({ message: filed }))

it('says an archive out of the Inbox on the click, before the server answers', () => {
  fetcher.mockReturnValue(new Promise(() => {}))
  archiveFrom('inbox').handleArchiveThreads(['t1'])

  expect(mocks.toast.success).toHaveBeenCalledWith('Conversation archived', {
    action: { label: 'Undo', onClick: expect.any(Function) },
  })
})

it('waits for the answer to say an archive from a list the row stays on', async () => {
  let land: ((response: Response) => void) | undefined
  fetcher.mockReturnValue(
    new Promise((resolve) => {
      land = resolve
    }),
  )
  archiveFrom('a-folder').handleArchiveThreads(['t1'])
  expect(mocks.toast.success).not.toHaveBeenCalled()

  await vi.waitFor(() => expect(land).toBeDefined())
  land?.(answer({ updated: ['m1'], left_inbox: false }))
  await vi.waitFor(() =>
    expect(mocks.toast.success).toHaveBeenCalledWith('Added to Archive', expect.anything()),
  )
})

it('puts an archived row back on Undo at once, and takes the archive back only once it lands', async () => {
  let land: ((response: Response) => void) | undefined
  fetcher.mockReturnValueOnce(
    new Promise((resolve) => {
      land = resolve
    }),
  )
  fetcher.mockResolvedValue(new Response(JSON.stringify({ message: null })))
  const restoreThreadsToList = vi.fn()
  archiveFrom('inbox', restoreThreadsToList).handleArchiveThreads(['t1'])
  await vi.waitFor(() => expect(land).toBeDefined())

  mocks.setUndoAction.mock.calls.findLast(([action]) => action)![0]()
  // Back on the click, held until the undo lands; the archive is still on its way.
  expect(restoreThreadsToList).toHaveBeenCalledOnce()
  expect(restoreThreadsToList.mock.calls[0][0]).toMatchObject([{ thread_id: 't1' }])
  expect(restoreThreadsToList.mock.calls[0][1]).toBeInstanceOf(Promise)
  await new Promise((resolve) => setTimeout(resolve))
  expect(fetcher).toHaveBeenCalledOnce()

  land?.(answer({ updated: ['m1'], left_inbox: true }))
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
    mails: [{ id: 'm1', mailbox_ids: ['inbox'], junk: 0 }],
  })
  expect(restoreThreadsToList).toHaveBeenCalledOnce()
})

it('moves the mail of a row that has already left the list', async () => {
  const message = { id: 'm1', name: 'm1', draft: 0, junk: 0, mailboxes: [{ mailbox_id: 'inbox' }] }
  const conversation = fromPartial<Thread>({ ...message, thread_id: 't1', messages: [message] })
  const rows = ref([conversation])
  fetcher.mockResolvedValue(answer({ updated: ['m1'], left_inbox: true }))
  const actions = scope.run(() =>
    useThreadActions({
      rows: computed(() => rows.value),
      mailbox: computed(() => 'inbox'),
      threadID: computed(() => undefined),
      selections: ref([]),
      mailThreadRef: ref(null),
      resetThreads: vi.fn(),
      syncAfterAction: vi.fn(),
      removeThreadsFromList: () => {
        rows.value = []
        return [conversation]
      },
      restoreThreadsToList: vi.fn(),
      refillIfEmpty: vi.fn(),
      goToMailbox: vi.fn(),
      goToNextThreadOrMailbox: vi.fn(),
    }),
  )!

  actions.handleMoveThreads({ trash: ['t1'] })
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
    ids: ['m1'],
    mailbox: 'trash',
  })
})

describe('the confirmation for deleting conversations forever', () => {
  it('names how many, says it is for good, and its button says what it does', () => {
    const confirm = vi.fn()
    const options = deleteForeverOptions(3, confirm)

    expect(options.title).toBe('Delete 3 conversations forever?')
    expect(options.message).toContain('can’t be undone')
    expect(options.actions.map((action) => action.label)).toEqual(['Cancel', 'Delete Forever'])
    const remove = options.actions[1]
    expect(remove).toMatchObject({ theme: 'red' })

    remove.onClick?.()
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('speaks of one conversation as one', () => {
    expect(deleteForeverOptions(1, () => {}).title).toBe('Delete this conversation forever?')
  })
})
