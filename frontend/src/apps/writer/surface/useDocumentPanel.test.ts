import { toast } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DocumentSession } from '@/apps/drive'

import { useDocumentPanel } from './useDocumentPanel'

vi.mock('frappe-ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// A Drive session that records the versions taken
function versionsSession() {
  const taken: [string | undefined, string | undefined][] = []
  const session = {
    comments: { list: vi.fn(), create: vi.fn() },
    versions: {
      list: vi.fn(() => Promise.resolve({ rows: [], next_cursor: null })),
      create: vi.fn((kind?: string, label?: string) => {
        taken.push([kind, label])
        return Promise.resolve()
      }),
    },
  } as unknown as Pick<DocumentSession, 'comments' | 'versions'>
  return { session, taken }
}

async function noRefresh() {}

afterEach(() => vi.clearAllMocks())

describe('saving a named version', () => {
  it('takes the version only after the edits are saved', async () => {
    const { session, taken } = versionsSession()
    const order: string[] = []
    async function saveFirst() {
      await Promise.resolve()
      order.push(`saved before ${taken.length} versions`)
    }

    const isTaken = await useDocumentPanel(session, noRefresh).saveVersion('Draft one', saveFirst)

    expect([isTaken, order, taken]).toEqual([
      true,
      ['saved before 0 versions'],
      [['named', 'Draft one']],
    ])
  })

  it('takes no version when the edits could not be saved, and says why', async () => {
    const { session, taken } = versionsSession()
    async function saveFirst() {
      throw new Error('No version was taken: saving is paused.')
    }

    const isTaken = await useDocumentPanel(session, noRefresh).saveVersion('Draft one', saveFirst)

    expect([isTaken, taken, vi.mocked(toast.error).mock.calls]).toEqual([
      false,
      [],
      [['No version was taken: saving is paused.']],
    ])
  })
})

// A Drive session whose comment calls succeed, or fail with Drive's reason
function commentsSession(refusal?: string) {
  const calls: string[] = []
  function call(name: string) {
    return (...args: unknown[]) => {
      const given = args.filter(Boolean).join(' ')
      calls.push(`${name} ${given}`)
      if (refusal) {
        return Promise.reject(new Error(refusal))
      }

      return Promise.resolve()
    }
  }

  const comments = { reply: call('reply'), resolve: call('resolve'), remove: call('remove') }
  const session = { comments, versions: {} } as unknown as Pick<
    DocumentSession,
    'comments' | 'versions'
  >
  return { session, calls }
}

describe('changing a thread from the panel', () => {
  it('reads the threads again after each change', async () => {
    const { session, calls } = commentsSession()
    async function refresh() {
      calls.push('read threads')
    }

    const panel = useDocumentPanel(session, refresh)
    await panel.reply('thread-1', 'Agreed', 'Asha')
    await panel.resolve('thread-1', true)
    await panel.removeComment('comment-2')

    expect(calls).toEqual([
      'reply thread-1 Agreed Asha',
      'read threads',
      'resolve thread-1 true',
      'read threads',
      'remove comment-2',
      'read threads',
    ])
  })

  it('says why a change was refused and keeps the threads as they are', async () => {
    const { session, calls } = commentsSession('You can only delete your own comments.')
    async function refresh() {
      calls.push('read threads')
    }

    const isRemoved = await useDocumentPanel(session, refresh).removeComment('comment-2')

    expect([isRemoved, calls, vi.mocked(toast.error).mock.calls]).toEqual([
      false,
      ['remove comment-2'],
      [['You can only delete your own comments.']],
    ])
  })
})
