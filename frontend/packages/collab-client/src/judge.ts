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
  const probe = (count: number): string | null => {
    const doc = new Y.Doc()
    try {
      if (checkpoint) Y.applyUpdate(doc, checkpoint)
      for (const row of rows.slice(0, count)) Y.applyUpdate(doc, row)
      return fault(doc)
    } catch (error) {
      return `throws: ${String(error)}`
    } finally {
      doc.destroy()
    }
  }
  if (!probe(rows.length)) return { verdict: 'clean' }
  const before = probe(0)
  if (before) return { verdict: 'bad', index: -1, reason: before }
  // Every prefix up to `good` is fine and the prefix of `bad` rows is not
  let good = 0
  let bad = rows.length
  let reason = ''
  while (bad - good > 1) {
    const middle = Math.floor((good + bad) / 2)
    const found = probe(middle)
    if (found) [bad, reason] = [middle, found]
    else good = middle
  }
  return { verdict: 'bad', index: bad - 1, reason: reason || probe(bad)! }
}
