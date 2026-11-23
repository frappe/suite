import { Extension } from '@tiptap/core'

interface CommentShortcutOptions {
  // Comments on the selected text
  onText: () => void
  // Comments on the whole document, when nothing is selected
  onDocument: () => void
}

/** Ctrl/Cmd+Alt+M comments on the selection, or on the whole document when nothing is selected. */
export const CommentShortcut = Extension.create<CommentShortcutOptions>({
  name: 'commentShortcut',

  addOptions() {
    return { onText: () => {}, onDocument: () => {} }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-m': () => {
        if (this.editor.state.selection.empty) {
          this.options.onDocument()
        } else {
          this.options.onText()
        }

        return true
      },
    }
  },
})
