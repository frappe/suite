import { anchorEnds } from '@/apps/writer/collab/anchors'
import { restoreEdit } from '@/apps/writer/collab/restore'
import { restoredAnchors, type AnchoredThread } from '@/apps/writer/collab/restoredAnchors'
import { withinTenSeconds } from '@/apps/writer/collab/timeout'
import type { CollabRoom } from '@/platform/collab'
import { noticeFor, refusedNotice, type RestoreNotice } from '@/platform/collab/restoreNotices'
import { translate as __ } from '@/platform/translation'

import { readVersionBody, type ConvertedVersion, type VersionBody } from './versions'

type RestoringRoom = Pick<
  CollabRoom,
  'doc' | 'lineage' | 'flush' | 'restoreVersion' | 'isCommitted'
>

/** A restore's notice, with new anchors for threads whose text it brought back and the server holds. */
export interface VersionRestore extends RestoreNotice {
  anchors: Record<string, string>
}

/** Restores version `seq` from its stored bytes, after this tab's edits are saved; `convert` upgrades an old one. */
export async function restoreVersion(
  room: RestoringRoom,
  seq: number,
  bytes: Uint8Array,
  threads: AnchoredThread[],
  convert: () => Promise<ConvertedVersion>,
): Promise<VersionRestore> {
  let body: VersionBody
  try {
    body = await readVersionBody(bytes)
  } catch {
    return { isRestored: false, message: __("This version can't be restored."), anchors: {} }
  }

  if ('legacy' in body) {
    const converted = await convert()
    if ('isPending' in converted) {
      return {
        isRestored: false,
        message: __('This version is still being upgraded. Try restoring it again in a minute.'),
        anchors: {},
      }
    }

    if ('refused' in converted) {
      return { ...refusedNotice(converted.refused), anchors: {} }
    }

    body = converted.body
  }

  await withinTenSeconds(room.flush())
  let anchors: Record<string, string> = {}
  const result = await room.restoreVersion(seq, () => {
    restoreEdit(room.doc, room.lineage, body)
    anchors = restoredAnchors(room.doc, room.lineage, body, threads)
  })
  if (result.outcome !== 'landed') {
    return { ...noticeFor(result, 'document'), anchors: {} }
  }

  return { ...noticeFor(result, 'document'), anchors: savedAnchors(room, anchors) }
}

// Only anchors on text the server holds, so a thread never points at text it lacks
function savedAnchors(room: RestoringRoom, anchors: Record<string, string>) {
  const saved: Record<string, string> = {}
  for (const [thread, anchor] of Object.entries(anchors)) {
    if (room.isCommitted(anchorEnds(anchor))) {
      saved[thread] = anchor
    }
  }

  return saved
}
