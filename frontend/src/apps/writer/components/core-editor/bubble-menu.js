import { TextSelection } from '@tiptap/pm/state'

// Positions the bubble menu to the right of the editor, vertically
// centered between the start and end of the current selection.
export function bubbleMenuOptions({ editor, comments }) {
  return {
    shouldShow: ({ state, from, to }) => {
      if (from === to) return false
      // Only show for text selections — not node selections (images) or cell selections (tables)
      if (!(state.selection instanceof TextSelection)) return false
      let hide = false
      comments.forEach((k) => (k.new || k.edit) && (hide = true))
      return !hide
    },
    getReferencedVirtualElement: () => {
      const { selection } = editor.value.state
      const { from, to } = selection

      const start = editor.value.view.coordsAtPos(from)
      const end = editor.value.view.coordsAtPos(to)

      const editorRect = editor.value.view.dom.getBoundingClientRect()
      const y = (start.bottom + end.bottom) / 2 + 15

      return {
        getBoundingClientRect: () => ({
          width: 0,
          height: 0,
          x: editorRect.right,
          y,
          top: y,
          right: editorRect.right,
          bottom: y,
          left: editorRect.right,
        }),
      }
    },
  }
}
