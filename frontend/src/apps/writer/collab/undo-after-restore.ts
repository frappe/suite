import type { CollabRoom } from '@suite/collab-client'
import { Extension } from '@tiptap/core'
import { yUndoPluginKey } from '@tiptap/y-tiptap'

/** Forgets the editor's undo steps whenever a restore lands, so Ctrl+Z never reaches past it. */
export const UndoAfterRestore = Extension.create<
  { room: CollabRoom | null },
  { stop: (() => void) | null }
>({
  name: 'undoAfterRestore',

  addOptions() {
    return { room: null }
  },

  addStorage() {
    return { stop: null }
  },

  onBeforeCreate() {
    const room = this.options.room!
    let restoreRev = room.restoreRev
    this.storage.stop = room.onChange(() => {
      if (room.restoreRev === restoreRev) {
        return
      }

      restoreRev = room.restoreRev
      yUndoPluginKey.getState(this.editor.state)?.undoManager.clear()
    })
  },

  onDestroy() {
    this.storage.stop?.()
  },
})
