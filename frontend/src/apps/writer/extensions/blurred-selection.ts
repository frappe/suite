import { Extension, isNodeSelection } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const key = new PluginKey<boolean>('blurredSelection')

/**
 * Draws the selection while the editor is blurred, so it stays visible behind menus and dialogs.
 * Forked from `Selection` in `@tiptap/extensions`: that one drops the decoration in the focus
 * transaction, and the redraw writes the old selection into the DOM before a click places the
 * caret, so the click is lost. Here a click that focuses the editor keeps the decoration until the
 * click's own selection arrives.
 */
export const BlurredSelection = Extension.create({
  name: 'blurredSelection',

  addProseMirrorPlugins() {
    const { editor } = this
    let pressedWhileBlurred = false
    return [
      new Plugin<boolean>({
        key,
        state: {
          init: () => false,
          apply(tr, held) {
            if (tr.getMeta('focus')) {
              const pressed = pressedWhileBlurred
              pressedWhileBlurred = false
              return pressed
            }
            return held && !tr.selectionSet
          },
        },
        props: {
          handleDOMEvents: {
            mousedown(view) {
              pressedWhileBlurred = !view.hasFocus()
              return false
            },
          },
          decorations(state) {
            const { selection } = state
            const hidden = editor.isFocused && !key.getState(state)
            if (hidden || selection.empty || !editor.isEditable) return null
            if (isNodeSelection(selection) || editor.view.dragging) return null
            return DecorationSet.create(state.doc, [
              Decoration.inline(selection.from, selection.to, { class: 'selection' }),
            ])
          },
        },
      }),
    ]
  },
})
