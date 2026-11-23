import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import { encodeAnchor, readAnchor } from './anchors'
import type { AnchoredThread } from './restoredAnchors'

interface ThreadsAfterUndoOptions {
  threads: () => readonly AnchoredThread[]
  // Told the new anchors, by thread, for Drive to keep
  moved: (anchors: Record<string, string>) => void
}

/**
 * Moves threads onto their text when Ctrl+Z or Ctrl+Y in this tab makes it again.
 * Yjs makes the text again as new characters and links the old ones to them in
 * this tab's memory only, so every other tab, and this one after a reload, would
 * see the thread's text as deleted.
 */
export const ThreadsAfterUndo = Extension.create<ThreadsAfterUndoOptions>({
  name: 'threadsAfterUndo',

  addOptions() {
    return { threads: () => [], moved: () => {} }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin({
        view: (view) => {
          const undoManager = yUndoPluginKey.getState(view.state)?.undoManager
          const doc = ySyncPluginKey.getState(view.state)?.doc
          if (!undoManager || !doc) {
            return {}
          }

          const onPopped = () => {
            const anchors = undoneAnchors(doc, options.threads())
            if (Object.keys(anchors).length) {
              options.moved(anchors)
            }
          }
          undoManager.on('stack-item-popped', onPopped)
          return { destroy: () => undoManager.off('stack-item-popped', onPopped) }
        },
      }),
    ]
  },
})

/** New anchors, by thread, for threads whose text an undo or redo in this tab made again. */
export function undoneAnchors(doc: Y.Doc, threads: readonly AnchoredThread[]) {
  const anchors: Record<string, string> = {}
  for (const thread of threads) {
    const anchor = undoneAnchor(doc, thread.anchor)
    if (anchor) {
      anchors[thread.name] = anchor
    }
  }

  return anchors
}

function undoneAnchor(doc: Y.Doc, anchor: string) {
  const read = readAnchor(anchor)
  if (read.kind !== 'text' || !(isMadeAgain(doc, read.start) || isMadeAgain(doc, read.end))) {
    return null
  }

  const start = madeAgainAt(doc, read.start)
  const end = madeAgainAt(doc, read.end)
  if (!start || !end) {
    return null
  }

  return encodeAnchor(start, end, read.quote)
}

// Whether the character a position holds was deleted and then made again by undo or redo here
function isMadeAgain(doc: Y.Doc, position: Y.RelativePosition) {
  const id = position.item
  if (!id || Y.getState(doc.store, id.client) <= id.clock) {
    return false
  }

  const item = Y.getItem(doc.store, id)
  return item instanceof Y.Item && item.deleted && item.redone !== null
}

// The same position, held by the character that now stands for the one it held
function madeAgainAt(doc: Y.Doc, position: Y.RelativePosition) {
  const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc)
  if (!absolute) {
    return null
  }

  return Y.createRelativePositionFromTypeIndex(absolute.type, absolute.index, position.assoc)
}
