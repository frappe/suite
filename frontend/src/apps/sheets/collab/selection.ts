// A selection held by row/col id instead of position, so it stays on the same
// cells when another tab inserts or deletes rows above it. Undo remembers each
// step's selection this way (undo.ts), and presence sends this tab's selection
// this way (presence.ts), so a peer's box follows its cells too.

import type * as Y from 'yjs'

import { axis, type AxisName } from './schema'
import { docSheets } from './stores'

/** A selected range: sheet name and 0-based positions, as the canvas has them. */
export interface Selection {
  sheet: string
  r0: number
  c0: number
  r1: number
  c1: number
}

// Past the end of an id list there are no ids yet: those ends keep a position.
type End = string | number

/** A selection by sheet id and row/col ids. */
export interface SavedSelection {
  sheetId: string
  r0: End
  c0: End
  r1: End
  c1: End
}

/** The selection by ids, or null when its sheet isn't in the doc. */
export function selectionToIds(doc: Y.Doc, sel: Selection | null): SavedSelection | null {
  if (!sel) return null
  const sheetId = docSheets(doc).find((s) => s.name === sel.sheet)?.id
  if (!sheetId) return null
  const end = (name: AxisName, pos: number): End => axis(doc, sheetId, name).idAt(pos) ?? pos
  return {
    sheetId,
    r0: end('rows', sel.r0),
    c0: end('cols', sel.c0),
    r1: end('rows', sel.r1),
    c1: end('cols', sel.c1),
  }
}

/** The selection by position now; null when its sheet, or a row/col it ends on, is gone. */
export function selectionFromIds(
  doc: Y.Doc,
  saved: SavedSelection | null | undefined,
): Selection | null {
  if (!saved) return null
  const sheet = docSheets(doc).find((s) => s.id === saved.sheetId)?.name
  if (sheet === undefined) return null
  const pos = (name: AxisName, end: End) =>
    typeof end === 'number' ? end : axis(doc, saved.sheetId, name).posOf(end)
  const sel = {
    sheet,
    r0: pos('rows', saved.r0),
    c0: pos('cols', saved.c0),
    r1: pos('rows', saved.r1),
    c1: pos('cols', saved.c1),
  }
  return sel.r0 < 0 || sel.c0 < 0 || sel.r1 < 0 || sel.c1 < 0 ? null : sel
}

const isEnd = (v: unknown): v is End =>
  (typeof v === 'string' && v.length > 0 && v.length <= 64) ||
  (typeof v === 'number' && Number.isInteger(v) && v >= 0)

/** Whether `raw` (another tab's presence, untrusted) is a selection by ids; keeps only its fields. */
export function readSavedSelection(raw: unknown): SavedSelection | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { sheetId, r0, c0, r1, c1 } = raw as Record<string, unknown>
  if (typeof sheetId !== 'string' || !sheetId || sheetId.length > 64) return null
  if (!isEnd(r0) || !isEnd(c0) || !isEnd(r1) || !isEnd(c1)) return null
  return { sheetId, r0, c0, r1, c1 }
}
