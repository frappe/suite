import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { changedRanges, touches } from './received-content-guard'

const TabTrailingNode = Extension.create({
  name: 'tabTrailingNode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tabTrailingNode'),
        appendTransaction(transactions, oldState, newState) {
          const { doc, tr, schema } = newState
          const changed = changedRanges(transactions)
          let modified = false

          doc.forEach((node, offset, index) => {
            if (node.type.name === 'tab') {
              const lastChild = node.lastChild
              const endPos = offset + node.nodeSize - 1
              if (lastChild.type === schema.nodes.table && touches(changed, endPos)) {
                tr.insert(tr.mapping.map(endPos), schema.nodes.paragraph.create())
                modified = true
              }
            } else if (
              node.type === schema.nodes.table &&
              doc.maybeChild(index + 1)?.type.name === 'tab' &&
              touches(changed, offset + node.nodeSize)
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