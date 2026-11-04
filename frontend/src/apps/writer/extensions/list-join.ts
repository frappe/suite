import type { Node } from '@tiptap/pm/model'
import { Plugin, type EditorState, type PluginSpec, type Transaction } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { ListJoin as StockListJoin } from 'frappe-ui/editor'

import { changedRanges, touches, type Range } from './ranges'
import { stockPlugin } from './stock-plugin'

function isList(node: Node) {
  return String(node.type.spec.group ?? '')
    .split(' ')
    .includes('list')
}

function isListContinuation(node: Node, parent: Node | null, index: number) {
  if (!parent || index === 0) {
    return false
  }

  const previousSibling = parent.child(index - 1)
  return isList(previousSibling) && previousSibling.sameMarkup(node)
}

// Joinable list boundaries next to `editedRanges`, back to front so earlier ones stay valid
function boundariesNear(doc: Node, editedRanges: Range[]) {
  const boundaries: number[] = []
  function collectBoundary(node: Node, pos: number, parent: Node | null, index: number) {
    if (isListContinuation(node, parent, index) && touches(editedRanges, pos - 1, pos + 1)) {
      boundaries.push(pos)
    }

    return !node.type.inlineContent
  }

  doc.descendants(collectBoundary)

  return boundaries.sort((left, right) => right - left).filter((pos) => canJoin(doc, pos))
}

function joinEditedBoundaries(transactions: readonly Transaction[], newState: EditorState) {
  if (!transactions.some((tr) => tr.docChanged)) {
    return null
  }

  const editedRanges = changedRanges(transactions)
  const boundaries = boundariesNear(newState.doc, editedRanges)
  if (!boundaries.length) {
    return null
  }

  const tr = newState.tr
  for (const pos of boundaries) {
    tr.join(pos)
  }

  return tr
}

// The stock repair on view creation would write the opened document back to
// Yjs, and the stock edit hook joins every pair in the document, which an
// untidy spot elsewhere would make the received content guard refuse
export const ListJoin = StockListJoin.extend({
  addProseMirrorPlugins() {
    const stock = stockPlugin(this.parent)
    const spec: PluginSpec<unknown> = {
      ...stock.spec,
      view(view) {
        if (ySyncPluginKey.getState(view.state)) {
          return {}
        }

        return stock.spec.view!(view)
      },
      appendTransaction: (transactions, _oldState, newState) =>
        joinEditedBoundaries(transactions, newState),
    }

    return [new Plugin(spec)]
  },
})
