import { Extension } from '@tiptap/core'
import { yUndoPluginKey } from '@tiptap/y-tiptap'

import type { CollabRoom } from '@/platform/collab'

/** Forgets the editor's undo steps whenever a restore lands, so Ctrl+Z never reaches past it. */
export const UndoAfterRestore = Extension.create<
  { room?: CollabRoom },
  { stop: (() => void) | null }
>({
  name: 'undoAfterRestore',

  addStorage() {
    return { stop: null }
  },

  onBeforeCreate() {
    const { room } = this.options
    if (!room) {
      throw new Error('UndoAfterRestore needs a room to watch for restores')
    }

    let restoreRev = room.status.restoreRev
    this.storage.stop = room.onChange(() => {
      if (room.status.restoreRev === restoreRev) {
        return
      }

      restoreRev = room.status.restoreRev
      yUndoPluginKey.getState(this.editor.state)?.undoManager.clear()
    })
  },

  onDestroy() {
    this.storage.stop?.()
  },
})
