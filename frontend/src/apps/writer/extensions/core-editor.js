import { Slice } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Extension } from '@tiptap/vue-3'

// Custom extension bundling an override of removeEmptyTextStyle (tabs strip
// all marks otherwise) and a copy transformer that unwraps single-tab
// selections.
export const CoreEditorExtension = Extension.create({
  addCommands() {
    return {
      removeEmptyTextStyle:
        () =>
        ({ tr }) => {
          const { selection } = tr
          tr.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
            if (!node.isText) return true
            const isEmpty = !node.marks
              .filter((mark) => mark.type.name === 'textStyle')
              .some((mark) => Object.values(mark.attrs).some((value) => !!value))
            if (isEmpty) {
              tr.removeMark(pos, pos + node.nodeSize, node.type.schema.marks.textStyle)
            }
          })
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformCopied(slice) {
            const frag = slice.content
            if (frag.childCount === 1 && frag.child(0).type.name === 'tab') {
              const tabNode = frag.child(0)
              return new Slice(tabNode.content, slice.openStart, slice.openEnd)
            }
            return slice
          },
        },
      }),
    ]
  },
})
