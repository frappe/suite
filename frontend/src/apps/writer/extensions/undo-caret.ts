import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection, type Transaction } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

/**
 * Puts the caret at the end of the text an undo or redo added or removed, so typing goes on
 * from there. Yjs puts back the caret from before the change, which leaves a
 * redone line's caret in front of its restored words.
 */
export const UndoCaret = Extension.create({
  name: 'undoCaret',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('undoCaret'),
        appendTransaction: (transactions, before, state) => {
          if (!transactions.some(isOwnUndoOrRedo)) return null
          // Undoing formatting keeps the selection it restores.
          const grown = state.doc.content.size - before.doc.content.size
          if (grown === 0) return null
          const start = before.doc.content.findDiffStart(state.doc.content)
          const end = before.doc.content.findDiffEnd(state.doc.content)?.b
          if (start === null || end === undefined) return null
          // A common last letter shortens the diff end, so also count the added size from the start.
          const caretPosition = Math.max(start + Math.max(grown, 0), end)
          const caret = Selection.near(state.doc.resolve(caretPosition), -1)
          return caret.eq(state.selection) ? null : state.tr.setSelection(caret)
        },
      }),
    ]
  },
})

function isOwnUndoOrRedo(tr: Transaction): boolean {
  return tr.docChanged && !!tr.getMeta(ySyncPluginKey)?.isUndoRedoOperation
}
