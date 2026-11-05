import { computed, shallowRef, watch, type Ref } from 'vue'

import type { DocumentSession, DocumentThread } from '@/apps/drive'
import { randomId } from '@/platform/random-id'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import { mentionedIn } from './commentMentions'
import { showError } from './useDocumentPanel'

type ThreadsChange = (threads: DocumentThread[]) => DocumentThread[]

interface Change {
  apply: ThreadsChange
  /** When Drive took it; null until then. */
  takenAt: number | null
}

interface ReplyChange extends Change {
  name: string
  isNotSent: boolean
  send: () => Promise<boolean>
}

interface ThreadChangeOptions {
  session: Pick<DocumentSession, 'comments'>
  /** The threads as Drive last answered. */
  readThreads: Ref<DocumentThread[]>
  /** When that read was sent. */
  readAt: Ref<number | null>
  refresh: () => Promise<void>
}

function withThread(
  name: string,
  change: (thread: DocumentThread) => DocumentThread,
): ThreadsChange {
  return (threads) => threads.map((thread) => (thread.name === name ? change(thread) : thread))
}

function withComment(
  name: string,
  change: (comment: DocumentThread['comments'][number]) => DocumentThread['comments'][number],
): ThreadsChange {
  return (threads) =>
    threads.map((thread) => ({
      ...thread,
      comments: thread.comments.map((comment) =>
        comment.name === name ? change(comment) : comment,
      ),
    }))
}

// A thread with no comments left is gone, as Drive deletes it with its last comment
const withoutComment =
  (name: string): ThreadsChange =>
  (threads) =>
    threads
      .map((thread) => ({
        ...thread,
        comments: thread.comments.filter((comment) => comment.name !== name),
      }))
      .filter((thread) => thread.comments.length)

/**
 * The document's threads with the person's own changes already in them. A change shows at once
 * and stays until a read sent after Drive took it, so the list never steps back. A refused change
 * goes away and says why; a refused reply stays, marked, to send again or discard.
 */
export function useThreadChanges({ session, readThreads, readAt, refresh }: ThreadChangeOptions) {
  const { comments } = session
  const { user } = useSession()
  const changes = shallowRef<Change[]>([])
  // Changes reach Drive in the order they were made
  let lastSent: Promise<unknown> = Promise.resolve()

  const threads = computed(() =>
    changes.value.reduce((shown, change) => change.apply(shown), readThreads.value),
  )
  const replies = computed(() => changes.value.filter(isReply))

  // A failed read leaves `readAt` alone, so a change Drive took stays until a later read has it
  watch(
    readAt,
    (at) => {
      if (at === null) return
      changes.value = changes.value.filter(({ takenAt }) => takenAt === null || takenAt > at)
    },
    { flush: 'sync' },
  )

  function isReply(change: Change): change is ReplyChange {
    return 'isNotSent' in change
  }

  function remove(change: Change) {
    changes.value = changes.value.filter((kept) => kept !== change)
  }

  function send(change: Change, request: () => Promise<unknown>, fallback: string) {
    const sent = lastSent.then(request).then(
      () => {
        change.takenAt = Date.now()
        void refresh()
        return true
      },
      (error: unknown) => {
        showError(error, fallback)
        return false
      },
    )
    lastSent = sent
    return sent
  }

  async function apply(apply: ThreadsChange, request: () => Promise<unknown>, fallback: string) {
    const change: Change = { apply, takenAt: null }
    changes.value = [...changes.value, change]
    const isTaken = await send(change, request, fallback)
    if (!isTaken) remove(change)
    return isTaken
  }

  function reply(thread: string, text: string, authorName?: string) {
    const clientId = randomId()
    const name = `unsent-${clientId}`
    const now = new Date().toISOString()
    const me = user.value
    const change: ReplyChange = {
      name,
      isNotSent: false,
      takenAt: null,
      apply: withThread(thread, (shown) => ({
        ...shown,
        comments: [
          ...shown.comments,
          {
            name,
            thread,
            node: shown.node,
            content: text,
            author: me?.id ?? 'Guest',
            author_name: authorName ?? null,
            person: me
              ? { id: me.id, full_name: me.fullName, user_image: me.avatar ?? null }
              : undefined,
            mentions: mentionedIn(text),
            creation: now,
            modified: now,
          },
        ],
      })),
      // The same client id each time, so Drive posts it once
      send: async () => {
        const isTaken = await send(
          change,
          () => comments.reply(thread, text, authorName, clientId),
          __('Could not add the reply.'),
        )
        change.isNotSent = !isTaken
        changes.value = [...changes.value]
        return isTaken
      },
    }
    changes.value = [...changes.value, change]
    return change.send()
  }

  function findReply(name: string) {
    return replies.value.find((change) => change.name === name)
  }

  return {
    threads,
    actions: {
      /** Answers whether Drive took it; the reply shows meanwhile, and stays if refused. */
      reply,
      /** Whether this comment is a reply Drive hasn't taken yet. */
      isUnsent: (comment: string) => !!findReply(comment),
      /** Whether Drive refused this reply. */
      isNotSent: (comment: string) => !!findReply(comment)?.isNotSent,
      retryReply(comment: string) {
        const change = findReply(comment)
        if (!change) return
        change.isNotSent = false
        changes.value = [...changes.value]
        void change.send()
      },
      discardReply(comment: string) {
        const change = findReply(comment)
        if (change) remove(change)
      },
      resolve: (thread: string, isResolved: boolean) =>
        apply(
          withThread(thread, (shown) => ({
            ...shown,
            resolved: isResolved,
            resolved_by: isResolved ? (user.value?.id ?? null) : null,
            resolved_at: isResolved ? new Date().toISOString() : null,
          })),
          () => comments.resolve(thread, isResolved),
          __('Could not change the thread.'),
        ),
      editComment: (comment: string, text: string) =>
        apply(
          withComment(comment, (shown) => ({
            ...shown,
            content: text,
            mentions: mentionedIn(text),
            modified: new Date().toISOString(),
          })),
          () => comments.edit(comment, text),
          __('Could not save the comment.'),
        ),
      removeComment: (comment: string) =>
        apply(
          withoutComment(comment),
          () => comments.remove(comment),
          __('Could not delete the comment.'),
        ),
    },
  }
}

export type ThreadActions = ReturnType<typeof useThreadChanges>['actions']
