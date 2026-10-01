import { Extension } from '@tiptap/core'
import { Plugin, type Transaction } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

// Every viewer runs the same normalizers, and Yjs keeps each viewer's copy of
// an insert, so normalizers may only follow up the user's own edits.
export const ReceivedContentGuard = Extension.create<object, { root: Transaction | null }>({
  name: 'receivedContentGuard',

  addStorage() {
    return { root: null }
  },

  dispatchTransaction({ transaction, next }) {
    this.storage.root = transaction
    try {
      next(transaction)
    } finally {
      this.storage.root = null
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin({
        filterTransaction: (tr) => {
          const { root } = storage
          if (!root || tr === root || !tr.docChanged) return true
          return root.docChanged && !root.getMeta(ySyncPluginKey)?.isChangeOrigin
        },
      }),
    ]
  },
})
