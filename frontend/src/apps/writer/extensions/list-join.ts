import { Plugin } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { ListJoin as StockListJoin } from 'frappe-ui/editor'

// The stock repair on view creation would write the opened document back to
// Yjs; edits still join lists through the stock appendTransaction.
export const ListJoin = StockListJoin.extend({
  addProseMirrorPlugins() {
    const [stock] = this.parent!()
    return [
      new Plugin({
        ...stock.spec,
        view: (view) => (ySyncPluginKey.getState(view.state) ? {} : stock.spec.view!(view)),
      }),
    ]
  },
})
