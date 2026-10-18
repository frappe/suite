import type { CollabRoom } from '@suite/collab-client'
import { useEventListener } from '@vueuse/core'
import { toast } from 'frappe-ui'
import { v4 } from 'uuid'
import { ref, type Ref } from 'vue'
import * as Y from 'yjs'

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

// The drafts on screen, each change kept on the device as it is made
function deviceDrafts(user: string, node: string) {
  const kept = readDrafts(user, node).map((draft) => ({ ...draft, isPosting: false }))
  const drafts = ref<ShownDraft[]>(kept)
  followOtherTabs(user, node, drafts)
  function keep({ clientId, anchor, text, isSent }: ShownDraft) {
    keepDraft(user, node, { clientId, anchor, text, isSent })
  }

  return {
    drafts,
    start(anchor: string) {
      const draft: ShownDraft = {
        clientId: v4(),
        anchor,
        text: '',
        isSent: false,
        isPosting: false,
      }
      keep(draft)
      drafts.value = [...drafts.value, draft]
    },
    write(draft: ShownDraft, text: string) {
      draft.text = text
      keep(draft)
    },
    send(draft: ShownDraft) {
      draft.isSent = true
      keep(draft)
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
    const current = room()
    const items = anchorEnds(draft.anchor)
    if (current && !isInCopy(current.doc, items)) {
      toast.error("The text this comment is on wasn't saved, so it wasn't posted.")
      return null
    }

    if (!(await whenSaved(current, items))) {
      toast.error("The text wasn't saved, so the comment wasn't posted. It's kept on this device.")
      return null
    }

    // Read from the device now, as another tab's discard may not have reached this one yet
    const isShown = list.drafts.value.some((shown) => shown.clientId === draft.clientId)
    if (!isShown || isDiscarded(user, session.nodeId, draft.clientId)) {
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
function isInCopy(doc: Y.Doc, items: Y.ID[]) {
  return items.every((id) => Y.getState(doc.store, id.client) > id.clock)
}

// Whether the server came to hold the commented text; false once this tab can't save it
function whenSaved(room: CollabRoom | null, items: Y.ID[]) {
  return new Promise<boolean>((resolve) => {
    // With no room, only a comment on no text is saved
    if (!room) {
      resolve(!items.length)
      return
    }

    function check() {
      if (room!.committedCovers(items)) {
        settle(true)
      } else if (room!.stopped) {
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
