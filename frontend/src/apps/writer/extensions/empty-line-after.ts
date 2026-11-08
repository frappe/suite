import { Selection, TextSelection, type Transaction } from '@tiptap/pm/state'

/**
 * Puts the caret on an empty line at `position`, the end of a block just put in,
 * so the next words start on their own line instead of joining the next block.
 * An empty paragraph already there is reused.
 */
export function selectEmptyLineAfter(tr: Transaction, position: number): Transaction {
  const $position = tr.doc.resolve(position)
  const next = $position.nodeAfter
  if (next?.type.name === 'paragraph' && next.content.size === 0)
    return tr.setSelection(TextSelection.create(tr.doc, position + 1))
  const paragraph = tr.doc.type.schema.nodes.paragraph
  const index = $position.index()
  if (!paragraph || !$position.parent.canReplaceWith(index, index, paragraph))
    return tr.setSelection(Selection.near($position, 1))
  tr.insert(position, paragraph.create())
  return tr.setSelection(TextSelection.create(tr.doc, position + 1))
}
