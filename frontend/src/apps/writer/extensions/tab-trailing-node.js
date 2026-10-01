import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const TabTrailingNode = Extension.create({
  name: 'tabTrailingNode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tabTrailingNode'),
        appendTransaction(transactions, oldState, newState) {
          const { doc, tr, schema } = newState
          let modified = false

          doc.forEach((node, offset, index) => {
            if (node.type.name === 'tab') {
              const lastChild = node.lastChild
              if (lastChild.type === schema.nodes.table) {
                const endPos = offset + node.nodeSize - 1
                tr.insert(tr.mapping.map(endPos), schema.nodes.paragraph.create())
                modified = true
              }
            } else if (
              node.type === schema.nodes.table &&
              doc.maybeChild(index + 1)?.type.name === 'tab'
            ) {
              // The first tab's content ends here, before the other tabs
              tr.insert(tr.mapping.map(offset + node.nodeSize), schema.nodes.paragraph.create())
              modified = true
            }
          })

          return modified ? tr : null
        },
      }),
    ]
  },
})

export default TabTrailingNode