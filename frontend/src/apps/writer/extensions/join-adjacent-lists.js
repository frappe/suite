import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'

// Deleting a block between two lists, or lifting an item out, leaves adjacent
// same-type list nodes that ProseMirror never merges, so the second list
// restarts its numbering. Join them back into one node after every change.
const JOINABLE = new Set(['orderedList', 'bulletList'])

export const JoinAdjacentLists = Extension.create({
  name: 'joinAdjacentLists',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('joinAdjacentLists'),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return

          // Boundary position (start of `child`) for every pair of adjacent
          // same-type list siblings. `descendants` skips the doc node itself,
          // so collect its direct children explicitly (content starts at 0).
          const boundaries = []
          const collect = (node, pos) => {
            node.forEach((child, offset, index) => {
              if (index === 0) return
              if (JOINABLE.has(child.type.name) && child.type === node.child(index - 1).type) {
                boundaries.push(pos + 1 + offset)
              }
            })
          }
          collect(newState.doc, -1)
          newState.doc.descendants(collect)
          if (!boundaries.length) return

          const tr = newState.tr
          let joined = false
          for (const pos of boundaries) {
            // Map through earlier joins in this transaction so the position
            // stays valid; canJoin then confirms the mapped boundary is real.
            const mapped = tr.mapping.map(pos)
            if (canJoin(tr.doc, mapped)) {
              tr.join(mapped)
              joined = true
            }
          }

          return joined ? tr : undefined
        },
      }),
    ]
  },
})
