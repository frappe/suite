import { useEventListener } from '@vueuse/core'
import { toast } from 'frappe-ui'
import { v4 } from 'uuid'
import { ref, type Ref } from 'vue'
import { getState, type Doc, type ID } from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import { anchorEnds } from '@/apps/writer/collab/anchors'
import {
  dropDraft,
  isDiscarded,
  keepDraft,
  readDrafts,
  removedElsewhere,
  type CommentDraft,
} from '@/apps/writer/recovery/commentDrafts'
import type { CollabRoom } from '@/platform/collab'

import { showError } from './useDocumentPanel'

/** A draft on screen; posting lasts while its text saves and Drive answers. */
export interface ShownDraft extends CommentDraft {
  isPosting: boolean
}

interface DraftOptions {
  session: Pick<DocumentSession, 'comments' | 'nodeId'>
  user: string
  room: () => CollabRoom | null
  refreshThreads: () => Promise<void>
}

function newDraft(anchor: string): ShownDraft {
  return {
    clientId: v4(),
    anchor,
    text: '',
    isSent: false,
    isPosting: false,
  }
}

function keepShownDraft(
  user: string,
  node: string,
  { clientId, anchor, text, isSent }: ShownDraft,
) {
  keepDraft(user, node, { clientId, anchor, text, isSent })
}

// The drafts on screen, each change kept on the device as it is made
function deviceDrafts(user: string, node: string) {
  const kept = readDrafts(user, node).map((draft) => ({ ...draft, isPosting: false }))
  const drafts = ref<ShownDraft[]>(kept)
  followOtherTabs(user, node, drafts)

  return {
    drafts,
    start(anchor: string) {
      const draft = newDraft(anchor)
      keepShownDraft(user, node, draft)
      drafts.value = [...drafts.value, draft]
    },
    write(draft: ShownDraft, text: string) {
      draft.text = text
      keepShownDraft(user, node, draft)
    },
    send(draft: ShownDraft) {
      draft.isSent = true
      keepShownDraft(user, node, draft)
    },
    discard(draft: ShownDraft) {
      dropDraft(user, node, draft.clientId)
      drafts.value = drafts.value.filter((shown) => shown.clientId !== draft.clientId)
    },
  }
}

// Drops the drafts another tab posted or discarded, and takes on none it starts
function followOtherTabs(user: string, node: string, drafts: Ref<ShownDraft[]>) {
  useEventListener(window, 'storage', (event) => {
    const removed = removedElsewhere(user, node, event)
    drafts.value = drafts.value.filter((draft) => !removed.has(draft.clientId))
  })
}

// Whether the server holds the commented text, telling the person when it doesn't
async function hasSavedText(current: CollabRoom | null, anchor: string) {
  const items = anchorEnds(anchor)
  if (current && !isInCopy(current.doc, items)) {
    toast.error("The text this comment is on wasn't saved, so it wasn't posted.")
    return false
  }

  const isSaved = await whenSaved(current, items)
  if (!isSaved) {
    toast.error("The text wasn't saved, so the comment wasn't posted. It's kept on this device.")
    return false
  }

  return true
}

// Read from the device now, as another tab's discard may not have reached this one yet
function isDraftKept(shown: ShownDraft[], user: string, node: string, draft: ShownDraft) {
  const isShown = shown.some((kept) => kept.clientId === draft.clientId)
  return isShown && !isDiscarded(user, node, draft.clientId)
}

/** Comments from being written to being posted, kept on this device until Drive takes them. */
export function useCommentDrafts({ session, user, room, refreshThreads }: DraftOptions) {
  const list = deviceDrafts(user, session.nodeId)
  // The thread Drive made, or null with the draft kept, its words as first sent
  async function post(draft: ShownDraft, authorName?: string) {
    list.send(draft)
    draft.isPosting = true
    const thread = await postOnceSaved(draft, authorName)
    draft.isPosting = false
    if (thread) {
      list.discard(draft)
      await refreshThreads()
    }

    return thread
  }

  async function postOnceSaved(draft: ShownDraft, authorName?: string) {
    const isSaved = await hasSavedText(room(), draft.anchor)
    if (!isSaved) {
      return null
    }

    if (!isDraftKept(list.drafts.value, user, session.nodeId, draft)) {
      return null
    }

    return sendDraft(session, draft, authorName)
  }

  return { ...list, post }
}

// The thread Drive made or answered; a resend with the same client id never posts twice
async function sendDraft(session: DraftOptions['session'], draft: ShownDraft, authorName?: string) {
  try {
    const thread = await session.comments.create(
      draft.anchor,
      draft.text.trim(),
      authorName,
      draft.clientId,
    )
    return thread.name
  } catch (error) {
    if ((error as { type?: unknown } | null)?.type === 'DriveConflict') {
      toast.error('This comment was already posted with different words. Discard it to remove it.')
    } else {
      showError(error, 'Could not add the comment.')
    }

    return null
  }
}

// Whether this copy holds the commented text, saved or still waiting to be sent
function isInCopy(doc: Doc, items: ID[]) {
  return items.every((id) => getState(doc.store, id.client) > id.clock)
}

// Whether the server came to hold the commented text; false once this tab can't save it
function whenSaved(room: CollabRoom | null, items: ID[]) {
  return new Promise<boolean>((resolve) => {
    // With no room, only a comment on no text is saved
    if (!room) {
      resolve(!items.length)
      return
    }

    function check() {
      if (room!.isCommitted(items)) {
        settle(true)
      } else if (room!.status.stopReason) {
        settle(false)
      }
    }

    function settle(isSaved: boolean) {
      stopListening()
      room!.doc.off('update', check)
      resolve(isSaved)
    }

    const stopListening = room.onChange(check)
    room.doc.on('update', check)
    check()
  })
}
