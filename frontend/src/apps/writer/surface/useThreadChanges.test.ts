import { toast } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'

import type { DocumentSession, DocumentThread } from '@/apps/drive'

import { useThreadChanges } from './useThreadChanges'

vi.mock('frappe-ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/platform/session', async () => {
  const { computed } = await import('vue')
  const user = computed(() => ({ id: 'asha@x.com', fullName: 'Asha Rao', avatar: null }))
  return { useSession: () => ({ user }) }
})

function thread(name: string, ...comments: [string, string][]) {
  return {
    name,
    node: 'doc-1',
    resolved: false,
    comments: comments.map(([comment, content]) => ({ name: comment, thread: name, content })),
  } as unknown as DocumentThread
}

// Drive answering by hand: each call waits until it is answered, in the order it was sent
function drive(read: DocumentThread[]) {
  const sent: string[] = []
  const answers: { take(): void; refuse(reason: string): void }[] = []
  function call(name: string) {
    return (...args: unknown[]) =>
      new Promise<void>((take, reject) => {
        sent.push(`${name} ${args.filter(Boolean).join(' ')}`)
        answers.push({ take, refuse: (reason) => reject(new Error(reason)) })
      })
  }

  const comments = {
    reply: call('reply'),
    resolve: call('resolve'),
    edit: call('edit'),
    remove: call('remove'),
  }
  const readThreads = shallowRef(read)
  const readAt = ref<number | null>(null)
  const refresh = vi.fn(async () => {})
  const changes = useThreadChanges({
    session: { comments } as unknown as Pick<DocumentSession, 'comments'>,
    readThreads,
    readAt,
    refresh,
  })
  // A read holding what Drive had when it was sent; by default, after everything so far
  function answerRead(threads: DocumentThread[], sentAt = Date.now() + 1) {
    readThreads.value = threads
    readAt.value = sentAt
  }

  return { ...changes, sent, answers, answerRead, refresh }
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve))
  await nextTick()
}

function shown(threads: DocumentThread[]) {
  return threads.map((shownThread) => shownThread.comments.map(({ content }) => content))
}

afterEach(() => vi.clearAllMocks())

describe('a change shows before Drive answers', () => {
  it('shows a reply at once under my name, and keeps one copy once a read holds it', async () => {
    const { threads, actions, answers, answerRead } = drive([
      thread('t1', ['c1', 'Is this right?']),
    ])

    const sending = actions.reply('t1', 'Yes')

    expect(shown(threads.value)).toEqual([['Is this right?', 'Yes']])
    expect(threads.value[0].comments[1].person?.full_name).toBe('Asha Rao')

    await settled()
    answers[0].take()
    expect(await sending).toBe(true)
    expect(shown(threads.value)).toEqual([['Is this right?', 'Yes']])

    answerRead([thread('t1', ['c1', 'Is this right?'], ['c2', 'Yes'])])
    expect(shown(threads.value)).toEqual([['Is this right?', 'Yes']])
    expect(threads.value[0].comments[1].name).toBe('c2')
  })

  it('resolves, edits and deletes at once', () => {
    const { threads, actions } = drive([
      thread('t1', ['c1', 'First'], ['c2', 'Second']),
      thread('t2', ['c3', 'Only']),
    ])

    void actions.resolve('t1', true)
    void actions.editComment('c1', 'Reworded')
    void actions.removeComment('c3')

    expect(threads.value[0].resolved).toBe(true)
    // Deleting a thread's only comment takes the thread with it
    expect(shown(threads.value)).toEqual([['Reworded', 'Second']])
  })

  it('keeps a change Drive took when a read from before it answers', async () => {
    const { threads, actions, answers, answerRead } = drive([thread('t1', ['c1', 'First'])])
    const resolving = actions.resolve('t1', true)
    await settled()
    answers[0].take()
    await resolving

    answerRead([thread('t1', ['c1', 'First'])], Date.now() - 1000)
    expect(threads.value[0].resolved).toBe(true)
  })
})

describe('changes reach Drive', () => {
  it('one at a time, in the order they were made, reading again after each', async () => {
    const { actions, sent, answers, refresh } = drive([thread('t1', ['c1', 'First'])])

    const resolving = actions.resolve('t1', true)
    const reopening = actions.resolve('t1', false)
    await settled()
    expect(sent).toEqual(['resolve t1 true'])

    answers[0].take()
    await resolving
    await settled()
    expect(sent).toEqual(['resolve t1 true', 'resolve t1'])
    answers[1].take()
    await reopening
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})

describe('Drive refuses a change', () => {
  it('puts the thread back and says why', async () => {
    const { threads, actions, answers, refresh } = drive([thread('t1', ['c1', 'First'])])

    const removing = actions.removeComment('c1')
    expect(threads.value).toEqual([])
    await settled()
    answers[0].refuse('You can only delete your own comments.')

    expect(await removing).toBe(false)
    expect(shown(threads.value)).toEqual([['First']])
    expect(vi.mocked(toast.error).mock.calls).toEqual([['You can only delete your own comments.']])
    expect(refresh).not.toHaveBeenCalled()
  })

  it('keeps a refused reply to send again under the same client id, or discard', async () => {
    const { threads, actions, sent, answers } = drive([thread('t1', ['c1', 'First'])])

    const sending = actions.reply('t1', 'Yes')
    await settled()
    answers[0].refuse('No network.')
    expect(await sending).toBe(false)

    const unsent = threads.value[0].comments[1].name
    expect(shown(threads.value)).toEqual([['First', 'Yes']])
    expect(actions.isNotSent(unsent)).toBe(true)

    actions.retryReply(unsent)
    expect(actions.isNotSent(unsent)).toBe(false)
    await settled()
    expect(sent[1]).toBe(sent[0])

    answers[1].refuse('No network.')
    await settled()
    actions.discardReply(unsent)
    expect(shown(threads.value)).toEqual([['First']])
  })
})
