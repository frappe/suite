/**
 * Whether a collaborative body holds changes the server has not stored.
 *
 * The Yjs document is the one source of truth for that: every update to it
 * that did not come from the server's stored body is a change to store, from
 * this editor or from a peer. An update applied with the `server` origin, or
 * with none, is not: the first is the stored body itself, the second is
 * bookkeeping such as the permanent user mapping. The editor's own `change`
 * event is the wrong signal, because it also fires when the stored body is
 * first put into the editor.
 *
 * A save that completes clears the flag unless the body changed while it was
 * in flight; those changes still wait for the next save.
 */
import type { Ref } from 'vue'
import type * as Y from 'yjs'

/** The origin `useYjs` applies the server's stored body with. */
export const SERVER_ORIGIN = 'server'

export interface UnsavedTracking {
  /**
   * Runs `store` and clears the flag if nothing changed while it ran. A
   * `store` that throws leaves the flag set.
   */
  storeThrough(store: () => Promise<void>): Promise<void>
}

export function trackUnsaved(doc: Y.Doc, unsaved: Ref<boolean>, onChange: () => void): UnsavedTracking {
  let revision = 0
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (!origin || origin === SERVER_ORIGIN) return
    revision += 1
    unsaved.value = true
    onChange()
  })
  return {
    async storeThrough(store) {
      const stored = revision
      await store()
      if (revision === stored) unsaved.value = false
    },
  }
}
