import { mergeAttributes, Node } from '@tiptap/core'
import type { NodeType } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

import { selectEmptyLineAfter } from '@/apps/writer/extensions/empty-line-after'
import { translate as __ } from '@/platform/translation'

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

  // The editor labels the break; saved and exported HTML keep the bare div
  addNodeView() {
    return () => {
      const dom = document.createElement('div')
      dom.dataset.pageBreak = 'true'
      dom.dataset.label = __('Page break')
      return { dom }
    }
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) => {
          return chain()
            .insertContent({ type: this.name })
            .command(({ dispatch, tr }) => {
              const end = insertedBreakEnd(tr, this.type)
              if (end === null) return false
              if (dispatch) selectEmptyLineAfter(tr, end).scrollIntoView()
              return true
            })
            .run()
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

/** Where the page break the last step put in ends, or `null` without one. */
function insertedBreakEnd(tr: Transaction, type: NodeType): number | null {
  let end: number | null = null
  tr.mapping.maps.at(-1)?.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
    tr.doc.nodesBetween(newStart, newEnd, (node, position) => {
      if (node.type === type) end = position + node.nodeSize
    })
  })
  return end
}
