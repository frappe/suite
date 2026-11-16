import type { DocumentSession } from '@/apps/drive'
import type { CollabRoom } from '@/platform/collab'
import { useSession } from '@/platform/session'

import type { CommentAnchors } from './places'
import { useCommentDrafts } from './useCommentDrafts'
import { useDocumentThreads } from './useDocumentThreads'
import { useThreadChanges } from './useThreadChanges'
import { rankMentionsFor } from './useUsers'

export type DocumentComments = ReturnType<typeof useDocumentComments>

interface CommentOptions {
  /** Whether the person may see the discussion; no threads are read while false. */
  isShown: () => boolean
  /** Whether the comments panel is open; each opening reads the threads again. */
  isOpen: () => boolean
  /** The room a draft on text waits on; whole-document comments wait on none. */
  room?: () => CollabRoom | null
  /** Where the app's comments point; whole-document comments only when left out. */
  anchors?: CommentAnchors
}

/**
 * Everything the side panel's comments need for one open document: its threads
 * with this tab's changes on top, the thread actions, the drafts, and the
 * people its mention box offers.
 */
export function useDocumentComments(
  session: Pick<DocumentSession, 'comments' | 'nodeId'>,
  { isShown, isOpen, room = () => null, anchors }: CommentOptions,
) {
  const { threads: readThreads, readAt, refresh } = useDocumentThreads(session, isShown, isOpen)
  const { threads, actions } = useThreadChanges({ session, readThreads, readAt, refresh })
  const drafts = useCommentDrafts({
    session,
    user: useSession().user.value?.id ?? 'Guest',
    room,
    refreshThreads: refresh,
    anchors,
  })
  rankMentionsFor(session.nodeId)
  return { threads, readAt, refresh, actions, drafts }
}
