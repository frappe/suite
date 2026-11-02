import { TextSelection } from '@tiptap/pm/state'

// Shows the comment button over a text selection
export function bubbleMenuOptions() {
  return {
    shouldShow: ({ state, from, to }) => {
      if (from === to) return false

      // Only show for text selections — not node selections (images) or cell selections (tables)
      return state.selection instanceof TextSelection
    },
  }
}
