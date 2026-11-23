import { TextSelection } from '@tiptap/pm/state'

import { isEditingLink } from '@/apps/writer/extensions/link-editing'

// For a text selection, unless the link popover edits it
export function bubbleMenuShouldShow() {
  return ({ state, from, to }) => {
    if (from === to) return false
    // Not node selections (images) or cell selections (tables)
    if (!(state.selection instanceof TextSelection)) return false
    if (!state.doc.textBetween(from, to).trim()) return false
    return !isEditingLink(state)
  }
}
