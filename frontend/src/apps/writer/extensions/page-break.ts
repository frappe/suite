import { mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

interface PageBreakRuleOptions {
  HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /**
       * Add a page break
       */
      setPageBreak: () => ReturnType
      /**
       * Remove a page break
       */
      unsetPageBreak: () => ReturnType
    }
  }
}

export const PageBreakExtension = Node.create<PageBreakRuleOptions>({
  name: 'pageBreak',

  addOptions() {
    return {
      HTMLAttributes: {
        'data-page-break': 'true',
      },
    }
  },

  group: 'block',

  parseHTML() {
    return [
      {
        tag: 'div',
        getAttrs: (node) => (node as HTMLElement).dataset.pageBreak === 'true' && null,
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) => {
          return (
            chain()
              .insertContent({ type: this.name })
              // set cursor after page break
              .command(({ dispatch, tr }) => {
                if (dispatch) {
                  const { $to } = tr.selection
                  const posAfter = $to.end()

                  if ($to.nodeAfter) {
                    tr.setSelection(TextSelection.create(tr.doc, $to.pos))
                  } else {
                    // add node after page break if it’s the end of the document
                    const node = $to.parent.type.contentMatch.defaultType?.create({
                      style: {
                        pageBreakAfter: 'always',
                      },
                      'data-page-break': 'true',
                    })
                    if (node) {
                      tr.insert(posAfter, node)
                      tr.setSelection(TextSelection.create(tr.doc, posAfter))
                    }
                  }

                  tr.scrollIntoView()
                }

                return true
              })
              .run()
          )
        },
      unsetPageBreak:
        () =>
        ({ chain }) => {
          return chain()
            .deleteSelection()
            .command(() => true)
            .run()
        },
    }
  },
})
