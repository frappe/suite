import { restoreEdit } from '@/apps/slides/collab/restore'
import type { CollabRoom } from '@/platform/collab'
import { noticeFor, type RestoreNotice } from '@/platform/collab/restoreNotices'
import { translate as __ } from '@/platform/translation'

import { readVersionBody, type VersionBody } from './versions'

type RestoringRoom = Pick<CollabRoom, 'doc' | 'flush' | 'restoreVersion'>

// Past this, the room answers that this tab's edits are still saving
const FLUSH_WAIT_MS = 10_000

/**
 * Restores version `seq` from its stored bytes, after this tab's edits are saved. `beforeEdit` runs
 * just before the restore writes, inside its change.
 */
export async function restoreVersion(
  room: RestoringRoom,
  seq: number,
  bytes: Uint8Array,
  beforeEdit: () => void,
): Promise<RestoreNotice> {
  let body: VersionBody
  try {
    body = await readVersionBody(bytes)
  } catch {
    return { isRestored: false, message: __("This version can't be restored.") }
  }

  if (!('state' in body)) {
    return { isRestored: false, message: __("This version can't be restored.") }
  }

  const { state } = body
  await withinFlushWait(room.flush())
  const result = await room.restoreVersion(seq, () => {
    beforeEdit()
    restoreEdit(room.doc, state)
  })
  return noticeFor(result, 'presentation')
}

function withinFlushWait(work: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FLUSH_WAIT_MS)
  })
  return Promise.race([work, waited]).finally(() => clearTimeout(timer))
}
