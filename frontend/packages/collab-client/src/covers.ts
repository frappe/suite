import * as yjs from 'yjs'

/**
 * Whether `body` already holds every change in `rows`: applying them adds no struct and no
 * delete, and leaves nothing waiting on a change the body lacks. A row that throws is not held.
 */
export function covers(body: Uint8Array, rows: Uint8Array[]): boolean {
  const doc = new yjs.Doc()
  try {
    yjs.applyUpdate(doc, body)
    const before = yjs.snapshot(doc)
    for (const row of rows) {
      yjs.applyUpdate(doc, row)
    }

    const nothingPending = doc.store.pendingStructs === null && doc.store.pendingDs === null
    return nothingPending && yjs.equalSnapshots(before, yjs.snapshot(doc))
  } catch {
    return false
  } finally {
    doc.destroy()
  }
}
