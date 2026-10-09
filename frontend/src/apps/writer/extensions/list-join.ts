import type { Node } from '@tiptap/pm/model'
import { Plugin, type PluginSpec } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { ListJoin as StockListJoin } from 'frappe-ui/editor'

import { changedRanges, touches } from './received-content-guard'

const isList = (node: Node) =>
  String(node.type.spec.group ?? '')
    .split(' ')
    .includes('list')

// Joinable list boundaries next to `changed`, back to front so earlier ones stay valid
function boundariesNear(doc: Node, changed: [number, number][]) {
  const found: number[] = []
  const collect = (node: Node, pos: number, parent: Node | null, index: number) => {
    const before = index > 0 ? parent?.child(index - 1) : null
    const continuesList = !!before && isList(before) && before.sameMarkup(node)
    if (continuesList && touches(changed, pos - 1, pos + 1)) {
      found.push(pos)
    }
    return !node.type.inlineContent
  }
  doc.descendants(collect)

  return found.sort((a, b) => b - a).filter((pos) => canJoin(doc, pos))
}

// The stock repair on view creation would write the opened document back to
// Yjs, and the stock edit hook joins every pair in the document, which an
// untidy spot elsewhere would make the received content guard refuse
export const ListJoin = StockListJoin.extend({
  addProseMirrorPlugins() {
    const [stock] = this.parent!()
    const spec: PluginSpec<unknown> = {
      ...stock.spec,
      view: (view) => (ySyncPluginKey.getState(view.state) ? {} : stock.spec.view!(view)),
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some((tr) => tr.docChanged)) return null

        const changed = changedRanges(transactions)
        const boundaries = boundariesNear(newState.doc, changed)
        if (!boundaries.length) return null

        const tr = newState.tr
        boundaries.forEach((pos) => tr.join(pos))
        return tr
      },
    }

    return [new Plugin(spec)]
  },
})
