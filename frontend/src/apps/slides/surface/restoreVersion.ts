import type { ConvertedState } from '@/apps/drive'
import { restoreEdit } from '@/apps/slides/collab/restore'
import type { CollabRoom } from '@/platform/collab'
import { noticeFor, refusedNotice, type RestoreNotice } from '@/platform/collab/restoreNotices'
import { translate as __ } from '@/platform/translation'

import { readVersionBody, type VersionBody } from './versions'

type RestoringRoom = Pick<CollabRoom, 'doc' | 'flush' | 'restoreVersion'>

// Past this, the room answers that this tab's edits are still saving
const FLUSH_WAIT_MS = 10_000

/**
 * Restores version `seq` from its stored bytes, after this tab's edits are saved; `convert` upgrades an
 * old row version first (Q6). `beforeEdit` runs just before the restore writes, inside its change.
 */
export async function restoreVersion(
  room: RestoringRoom,
  seq: number,
  bytes: Uint8Array,
  beforeEdit: () => void,
  convert: () => Promise<ConvertedState>,
): Promise<RestoreNotice> {
  let body: VersionBody
  try {
    body = await readVersionBody(bytes)
  } catch {
    return { isRestored: false, message: __("This version can't be restored.") }
  }

  if (!('state' in body)) {
    const converted = await convert()
    if ('isPending' in converted) {
      return {
        isRestored: false,
        message: __('This version is still being upgraded. Try restoring it again in a minute.'),
      }
    }

    if ('refused' in converted) {
      // the server words the reason for whoever asked
      return refusedNotice(converted.refused)
    }

    body = converted
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
