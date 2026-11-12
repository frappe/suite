// Restoring a version through the content layer (#963): the room fences the
// sheet, this tab makes its doc equal to the version in one transaction, and
// the room sends that as one push. The server keeps the sheet as it was as a
// version first. The glue then applies the change to IronCalc and the side
// stores like any other tab's edit, and so does every other tab.

import * as Y from 'yjs'

import { openCollabRoom, type CollabRoom, type CollabSession } from '@/platform/collab'
import { translate as __ } from '@/platform/translation'

import { sheetsAdapter } from './adapter'
import { ROOT, roots } from './schema'

/** What the person is told after a restore. */
export interface RestoreNotice {
  isRestored: boolean
  message: string
}

function isVersionRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Reads a stored version: the Yjs state of a `sheets-document/2` version, or null for any other. */
export async function readVersionState(bytes: Uint8Array): Promise<Uint8Array | null> {
  let version: unknown
  try {
    version = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (!isVersionRecord(version)) return null
  const { schema, codec, state } = version
  if (schema !== 'sheets-document/2' || codec !== 'yjs1' || typeof state !== 'string') return null
  const compressed = Uint8Array.from(atob(state), (c) => c.charCodeAt(0))
  const stream = new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** What a stored version holds: a Yjs state, or the old body (`sheet/1`) of a sheet before editing together. */
export type StoredVersion = { state: Uint8Array } | { body: Record<string, unknown> }

/** Reads a stored version for showing; null for bytes that are neither kind. */
export async function readStoredVersion(bytes: Uint8Array): Promise<StoredVersion | null> {
  const state = await readVersionState(bytes)
  if (state) return { state }
  let version: unknown
  try {
    version = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (!isVersionRecord(version)) return null
  const { schema, sheets_data: body } = version
  if (schema !== 'sheet/1' || typeof body !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(body || '{}')
    return isVersionRecord(parsed) ? { body: parsed } : null
  } catch {
    return null
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function alignList(list: Y.Array<string>, want: string[]): void {
  if (same(list.toArray(), want)) return
  list.delete(0, list.length)
  list.push(want)
}

/**
 * Make `current` hold exactly what `version` holds, writing only what differs.
 * Call inside a transaction. `tails` only ever rises (schema.ts): a tail id a
 * later edit used must never be handed out again.
 */
export function alignDoc(current: Y.Doc, version: Y.Doc): void {
  const now = roots(current)
  const then = roots(version)
  alignList(now.sheets, then.sheets.toArray())
  for (const axis of [ROOT.rows, ROOT.cols] as const) {
    for (const sheetId of [...now[axis].keys()])
      if (!then[axis].has(sheetId)) now[axis].delete(sheetId)
    for (const [sheetId, ids] of then[axis].entries()) {
      const list = now[axis].get(sheetId)
      if (list) alignList(list, ids.toArray())
      else now[axis].set(sheetId, Y.Array.from(ids.toArray()))
    }
  }
  for (const name of Object.keys(now)) {
    if (name === 'sheets' || name === 'rows' || name === 'cols') continue
    if (name === 'tails') {
      for (const [key, n] of then.tails.entries())
        if ((now.tails.get(key) ?? -1) < n) now.tails.set(key, n)
      continue
    }
    const map = current.getMap<unknown>(name)
    const want = version.getMap<unknown>(name)
    for (const key of [...map.keys()]) if (!want.has(key)) map.delete(key)
    for (const [key, value] of want.entries()) if (!same(map.get(key), value)) map.set(key, value)
  }
}

// Literal __() calls, so the extractor finds them; called when shown.
const REFUSALS = new Map<string, () => string>([
  ['restoring', () => __('Someone else is restoring a version. Try again once it is done.')],
  ['behind', () => __('This tab is still catching up. Try again in a moment.')],
  [
    'milestone_failed',
    () =>
      __(
        "The spreadsheet as it is now couldn't be kept as a version first, so nothing was restored.",
      ),
  ],
  ['paused', () => __('Saving is paused, so nothing was restored.')],
])

/** Restore version `seq` (its stored bytes) into the room. */
export async function restoreVersion(
  room: Pick<CollabRoom, 'doc' | 'flush' | 'restoreVersion'>,
  seq: number,
  bytes: Uint8Array,
): Promise<RestoreNotice> {
  const state = await readVersionState(bytes)
  if (!state) {
    return {
      isRestored: false,
      message: __("This version is from before editing together and can't be restored here."),
    }
  }
  const version = new Y.Doc()
  try {
    Y.applyUpdate(version, state)
    await room.flush()
    const result = await room.restoreVersion(seq, () => alignDoc(room.doc, version))
    switch (result.outcome) {
      case 'landed':
        return { isRestored: true, message: __('Version restored') }
      case 'unchanged':
        return { isRestored: true, message: __('The spreadsheet already is this version.') }
      case 'unsent':
        return {
          isRestored: false,
          message: __(
            'Your latest changes are not saved yet. Try again when the spreadsheet is saved.',
          ),
        }
      default: {
        const known = result.refusal && REFUSALS.has(result.refusal)
        return {
          isRestored: false,
          message: known ? REFUSALS.get(result.refusal!)!() : __('The version was not restored.'),
        }
      }
    }
  } finally {
    version.destroy()
  }
}

/**
 * Make a fresh copy of the sheet hold a version's Yjs `state`. A copy keeps no
 * versions, so this is one ordinary edit through the copy's room, not a
 * restore. False when the copy did not open live or the edit was not saved.
 */
export async function writeVersionToCopy(
  copy: CollabSession,
  state: Uint8Array,
  open: typeof openCollabRoom = openCollabRoom,
): Promise<boolean> {
  const opened = await open({ session: copy, adapter: sheetsAdapter })
  if (opened.state !== 'live') return false
  const { room } = opened
  const version = new Y.Doc()
  try {
    Y.applyUpdate(version, state)
    room.doc.transact(() => alignDoc(room.doc, version))
    await room.flush()
    return room.status.unsentCount === 0
  } finally {
    version.destroy()
    await room.close()
  }
}
