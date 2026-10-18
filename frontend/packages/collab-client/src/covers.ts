import * as Y from 'yjs'

/**
 * Whether `body` already holds every change in `rows`: applying them adds no struct and no
 * delete, and leaves nothing waiting on a change the body lacks. A row that throws is not held.
 */
export function covers(body: Uint8Array, rows: Uint8Array[]): boolean {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, body)
    const before = Y.snapshot(doc)
    for (const row of rows) {
      Y.applyUpdate(doc, row)
    }

    const nothingPending = doc.store.pendingStructs === null && doc.store.pendingDs === null
    return nothingPending && Y.equalSnapshots(before, Y.snapshot(doc))
  } catch {
    return false
  } finally {
    doc.destroy()
  }
}
