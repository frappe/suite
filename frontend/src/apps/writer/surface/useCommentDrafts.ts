import type { CollabRoom } from '@suite/collab-client'
import { toast } from 'frappe-ui'
import { v4 } from 'uuid'
import { ref } from 'vue'
import type * as Y from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import { anchorEnds } from '@/apps/writer/collab/anchors'
import {
  dropDraft,
  keepDraft,
  readDrafts,
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
  function keep(draft: ShownDraft) {
    keepDraft(user, node, { clientId: draft.clientId, anchor: draft.anchor, text: draft.text })
  }

  return {
    drafts,
    start(anchor: string) {
      const draft: ShownDraft = { clientId: v4(), anchor, text: '', isPosting: false }
      keep(draft)
      drafts.value = [...drafts.value, draft]
    },
    write(draft: ShownDraft, text: string) {
      draft.text = text
      keep(draft)
    },
    discard(draft: ShownDraft) {
      dropDraft(user, node, draft.clientId)
      drafts.value = drafts.value.filter((shown) => shown.clientId !== draft.clientId)
    },
  }
}

/** Comments on text from being written to being posted, kept on this device until Drive takes them. */
export function useCommentDrafts({ session, user, room, refreshThreads }: DraftOptions) {
  const list = deviceDrafts(user, session.nodeId)
  async function post(draft: ShownDraft, authorName?: string) {
    draft.isPosting = true
    const isPosted = await postOnceSaved(draft, authorName)
    draft.isPosting = false
    if (isPosted) {
      list.discard(draft)
      await refreshThreads()
    }

    return isPosted
  }

  async function postOnceSaved(draft: ShownDraft, authorName?: string) {
    if (!(await whenSaved(room(), anchorEnds(draft.anchor)))) {
      toast.error("The text wasn't saved, so the comment wasn't posted. It's kept on this device.")
      return false
    }

    const isShown = list.drafts.value.some((shown) => shown.clientId === draft.clientId)
    return isShown && sendDraft(session, draft, authorName)
  }

  return { ...list, post }
}

// Whether Drive took the comment; a resend with the same client id never posts twice
async function sendDraft(session: DraftOptions['session'], draft: ShownDraft, authorName?: string) {
  try {
    await session.comments.create(draft.anchor, draft.text.trim(), authorName, draft.clientId)
  } catch (error) {
    showError(error, 'Could not add the comment.')
    return false
  }

  return true
}

// Whether the server came to hold the commented text; false once this tab can't save it
function whenSaved(room: CollabRoom | null, items: Y.ID[]) {
  return new Promise<boolean>((resolve) => {
    if (!room) {
      resolve(false)
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
