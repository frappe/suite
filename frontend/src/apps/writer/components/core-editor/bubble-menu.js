import { posToDOMRect } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

// In the margin level with the selection, else above it, else below
export function bubbleMenuOptions({ editor, comments }) {
  return {
    options: {
      placement: 'right',
      flip: { fallbackPlacements: ['top-start', 'bottom-start'], crossAxis: false },
    },
    shouldShow: ({ state, from, to }) => {
      if (from === to) return false
      // Only show for text selections — not node selections (images) or cell selections (tables)
      if (!(state.selection instanceof TextSelection)) return false
      let hide = false
      comments.forEach((k) => (k.new || k.edit) && (hide = true))
      return !hide
    },
    getReferencedVirtualElement: () => {
      const { view } = editor.value
      const { from, to } = view.state.selection
      const rect = posToDOMRect(view, from, to)
      const right = view.dom.getBoundingClientRect().right
      const box = { ...rect.toJSON(), right, width: right - rect.left }

      return { getBoundingClientRect: () => box }
    },
  }
}
