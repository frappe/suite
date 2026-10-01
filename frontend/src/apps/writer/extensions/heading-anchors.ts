import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import TableOfContents from '@tiptap/extension-table-of-contents'

// Opening or watching a document must never write to it. Ids are assigned
// only on the user's own edits; headings saved without one get an anchor drawn
// at render time instead.

type Anchor = {
  id: string | null
  textContent: string
  dom: HTMLElement
  isActive: boolean
  isScrolledOver: boolean
}

function renderedId(text: string, occurrence: number) {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return `h-${(hash >>> 0).toString(36)}-${occurrence}`
}

function renderedAnchors(doc: Node) {
  const seen = new Map<string, number>()
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    if (!node.textContent || node.attrs['data-toc-id']) return false
    const occurrence = seen.get(node.textContent) ?? 0
    seen.set(node.textContent, occurrence + 1)
    const id = renderedId(node.textContent, occurrence)
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { id, 'data-toc-id': id }))
    return false
  })
  return DecorationSet.create(doc, decorations)
}

function withRenderedIds(anchors: Anchor[], scrollPosition: number) {
  if (anchors.every((anchor) => anchor.id)) return anchors
  const seen = new Map<string, number>()
  const items = anchors.map((anchor) => {
    let id = anchor.id
    if (!id) {
      const occurrence = seen.get(anchor.textContent) ?? 0
      seen.set(anchor.textContent, occurrence + 1)
      id = renderedId(anchor.textContent, occurrence)
    }
    return { ...anchor, id, isScrolledOver: scrollPosition >= anchor.dom.offsetTop }
  })
  const active = items.findLast((item) => item.isScrolledOver)
  return items.map((item) => ({ ...item, isActive: item === active }))
}

const anchorDecorations = () =>
  new Plugin({
    key: new PluginKey('headingAnchorDecorations'),
    state: {
      init: (_config, state) => renderedAnchors(state.doc),
      apply: (tr, set) => (tr.docChanged ? renderedAnchors(tr.doc) : set),
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  })

export const HeadingAnchors = TableOfContents.extend({
  onBeforeCreate() {
    const onUpdate = this.options.onUpdate
    this.options.onUpdate = (anchors, isInitial) =>
      onUpdate?.(withRenderedIds(anchors as Anchor[], this.storage.scrollPosition) as never, isInitial)
  },

  onCreate() {
    const { view } = this.editor
    const dispatch = view.dispatch
    view.dispatch = (tr) => {
      if (!tr.docChanged) dispatch(tr)
    }
    try {
      this.parent?.()
    } finally {
      view.dispatch = dispatch
    }
  },

  addProseMirrorPlugins() {
    const [stock] = this.parent!()
    const assignIds = new Plugin({
      key: new PluginKey('headingAnchorIds'),
      appendTransaction(transactions, oldState, newState) {
        const local = transactions.filter((tr) => {
          const root = tr.getMeta('appendedTransaction') ?? tr
          return !root.getMeta(ySyncPluginKey)?.isChangeOrigin
        })
        if (!local.length) return null
        return stock.spec.appendTransaction!.call(stock, local, oldState, newState)
      },
    })
    return [assignIds, anchorDecorations()]
  },
})
