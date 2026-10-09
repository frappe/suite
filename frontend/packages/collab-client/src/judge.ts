import * as Y from 'yjs'

export type Verdict = { verdict: 'clean' } | { verdict: 'bad'; index: number; reason: string }

// What is wrong with a document a product's editor can't take, or null
export type Fault = (doc: Y.Doc) => string | null

/**
 * Finds the first row that breaks a document, applying rows one at a time as a tab does.
 * Index -1 is the checkpoint itself. Each probe rebuilds from scratch, because a row that
 * throws leaves the document partly applied.
 */
export function judge(checkpoint: Uint8Array | null, rows: Uint8Array[], fault: Fault): Verdict {
  const faultAfter = (count: number): string | null => {
    const doc = new Y.Doc()
    try {
      if (checkpoint) {
        Y.applyUpdate(doc, checkpoint)
      }
      for (const row of rows.slice(0, count)) {
        Y.applyUpdate(doc, row)
      }
      return fault(doc)
    } catch (error) {
      return `throws: ${String(error)}`
    } finally {
      doc.destroy()
    }
  }

  if (!faultAfter(rows.length)) return { verdict: 'clean' }

  const checkpointFault = faultAfter(0)
  if (checkpointFault) {
    return {
      verdict: 'bad',
      index: -1,
      reason: checkpointFault,
    }
  }

  // Every prefix up to `cleanPrefix` is fine and the prefix of `badPrefix` rows is not
  let cleanPrefix = 0
  let badPrefix = rows.length
  let reason = ''
  while (badPrefix - cleanPrefix > 1) {
    const middle = Math.floor((cleanPrefix + badPrefix) / 2)
    const middleFault = faultAfter(middle)
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
    reason: reason || faultAfter(badPrefix)!,
  }
}
