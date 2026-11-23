import * as yjs from 'yjs'

export type Verdict = { verdict: 'clean' } | { verdict: 'bad'; index: number; reason: string }

// What is wrong with a document a product's editor can't take, or null
export type Fault = (doc: yjs.Doc) => string | null

// Called after each probe drops its document, so a caller can collect it before the next is built
export type Release = () => void

const HALVES = 2

function faultAfter(
  checkpoint: Uint8Array | null,
  rows: Uint8Array[],
  fault: Fault,
  release: Release,
) {
  const doc = new yjs.Doc()
  try {
    if (checkpoint) {
      yjs.applyUpdate(doc, checkpoint)
    }

    for (const row of rows) {
      yjs.applyUpdate(doc, row)
    }

    return fault(doc)
  } catch (error) {
    const thrown = String(error)
    return `throws: ${thrown}`
  } finally {
    doc.destroy()
    release()
  }
}

function firstBadRow(rowCount: number, faultAt: (count: number) => string | null): Verdict {
  // Every prefix up to `cleanPrefix` is fine and the prefix of `badPrefix` rows is not
  let cleanPrefix = 0
  let badPrefix = rowCount
  let reason = ''
  while (badPrefix - cleanPrefix > 1) {
    const middle = Math.floor((cleanPrefix + badPrefix) / HALVES)
    const middleFault = faultAt(middle)
    if (middleFault) {
      badPrefix = middle
      reason = middleFault
    } else {
      cleanPrefix = middle
    }
  }

  return {
    verdict: 'bad',
    index: badPrefix - 1,
    reason: reason || faultAt(badPrefix)!,
  }
}

/**
 * Finds the first row that breaks a document, applying rows one at a time as a tab does.
 * Index -1 is the checkpoint itself. Each probe rebuilds from scratch, because a row that
 * throws leaves the document partly applied.
 */
export function judge(
  checkpoint: Uint8Array | null,
  rows: Uint8Array[],
  fault: Fault,
  release: Release,
): Verdict {
  function faultAt(count: number) {
    return faultAfter(checkpoint, rows.slice(0, count), fault, release)
  }

  if (!faultAt(rows.length)) {
    return { verdict: 'clean' }
  }

  const checkpointFault = faultAt(0)
  if (checkpointFault) {
    return {
      verdict: 'bad',
      index: -1,
      reason: checkpointFault,
    }
  }

  return firstBadRow(rows.length, faultAt)
}
