import type { CommentAnchors, DocumentThread, ThreadPlace, ThreadPlaces } from '@/apps/drive'
import { parseCellId } from '@/apps/sheets/utils/cells'

import { readAnchor, type CellAnchor } from './records'

// Rows and columns fit under these, so a place orders by sheet, then row, then column
const ROWS = 16_777_216
const COLUMNS = 32_768

/** A cell as the comments name it. */
export function cellLabel(cell: CellAnchor) {
  return `${cell.sheet} · ${cell.cell}`
}

/** A comment is on a cell, or on the whole spreadsheet; none waits on text to be saved. */
export const cellCommentAnchors: CommentAnchors = {
  quote: (anchor) => {
    const cell = readAnchor(anchor)
    if (!cell) {
      return ''
    }

    return cellLabel(cell)
  },
  ends: () => [],
}

/** Each thread's cell, by the order of `sheets`; a cell on a sheet that's gone comes last. */
export function cellPlaces(
  threads: readonly DocumentThread[],
  sheets: readonly string[],
): ThreadPlaces {
  return new Map(threads.map((thread) => [thread.name, placeOf(thread.anchor, sheets)]))
}

function placeOf(anchor: string, sheets: readonly string[]): ThreadPlace {
  const cell = readAnchor(anchor)
  const at = cell && parseCellId(cell.cell)
  if (!cell || !at) {
    return { kind: 'document' }
  }

  const missing = sheets.length
  const index = sheets.indexOf(cell.sheet)
  const sheet = index < 0 ? missing : index
  const from = (sheet * ROWS + at.row) * COLUMNS + at.col
  return { kind: 'text', from, to: from, quote: cellLabel(cell) }
}
