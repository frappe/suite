import { anchorEnds } from '@/apps/writer/collab/anchors'
import { restoreEdit } from '@/apps/writer/collab/restore'
import { restoredAnchors, type AnchoredThread } from '@/apps/writer/collab/restoredAnchors'
import { withinTenSeconds } from '@/apps/writer/collab/timeout'
import type { CollabRoom, RestoreResult } from '@/platform/collab'

import { readVersionBody, type ConvertedVersion, type VersionBody } from './versions'

type RestoringRoom = Pick<
  CollabRoom,
  'doc' | 'lineage' | 'flush' | 'restoreVersion' | 'isCommitted'
>

/** What the person is told after a restore: whether the document is the version now, and how it went. */
export interface RestoreNotice {
  isRestored: boolean
  message: string
  /** The converter refused an old version, so the person is offered its download instead. */
  canDownload?: boolean
}

/** A restore's notice, with new anchors for threads whose text it brought back and the server holds. */
export interface VersionRestore extends RestoreNotice {
  anchors: Record<string, string>
}

// The server's wait between restores, for a refusal that doesn't say how long is left
const RESTORE_EVERY_SECONDS = 60

const REFUSALS: Record<string, string> = {
  restoring: 'Someone else is restoring a version. Try again once it is done.',
  behind: 'This tab is still catching up. Try again in a moment.',
  milestone_failed:
    "The document as it is now couldn't be kept as a version first, so nothing was restored.",
  paused: 'Saving is paused, so nothing was restored.',
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
    return { isRestored: false, message: "This version can't be restored.", anchors: {} }
  }

  if ('legacy' in body) {
    const converted = await convert()
    if ('isPending' in converted) {
      return {
        isRestored: false,
        message: 'This version is still being upgraded. Try restoring it again in a minute.',
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
    return { ...noticeFor(result), anchors: {} }
  }

  return { ...noticeFor(result), anchors: savedAnchors(room, anchors) }
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

function refusedNotice(reason: string | null): RestoreNotice {
  let message = "This version couldn't be upgraded, so it can't be restored. You can download it."
  if (reason) {
    message += ` Reason: ${reason}.`
  }

  return { isRestored: false, message, canDownload: true }
}

function noticeFor(result: RestoreResult): RestoreNotice {
  if (result.outcome === 'landed') {
    return { isRestored: true, message: 'Version restored' }
  }

  if (result.outcome === 'unchanged') {
    return { isRestored: true, message: 'The document already matches this version.' }
  }

  if (result.outcome === 'unsent') {
    return { isRestored: false, message: 'Your changes are still saving. Try again in a moment.' }
  }

  if (result.refusal === 'restore_recent') {
    const wait = result.retryS ?? RESTORE_EVERY_SECONDS
    return {
      isRestored: false,
      message: `A restore just ran. Try again in ${wait} seconds.`,
    }
  }

  const message = REFUSALS[result.refusal ?? ''] ?? 'The version was not restored.'
  return { isRestored: false, message }
}
