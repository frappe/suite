import { Extension, type AnyExtension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { ySyncPlugin, yUndoPluginKey } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'

import type { RoomPresence } from '@/platform/collab'
import { Carets } from '@/platform/collab/carets'
import { UndoSteps } from '@/platform/collab/undo-steps'

// Hands the editor the presentation's one undo stack. Not `yUndoPlugin`: closing an
// editor would destroy the stack with it, and that stack outlives every editor
function sharedUndoStack(undoManager: Y.UndoManager) {
  return new Plugin({
    key: yUndoPluginKey,
    state: { init: () => ({ undoManager }), apply: (_transaction, state) => state },
  })
}

/** What ties one text editor to one element's text in the live document. */
export function liveTextExtensions(
  fragment: Y.XmlFragment,
  presence: RoomPresence,
  undoManager: Y.UndoManager,
): AnyExtension[] {
  const sync = Extension.create({
    name: 'slidesLiveText',
    priority: 1000,
    addProseMirrorPlugins: () => [ySyncPlugin(fragment), sharedUndoStack(undoManager)],
  })
  return [sync, Carets.configure({ presence }), UndoSteps]
}
