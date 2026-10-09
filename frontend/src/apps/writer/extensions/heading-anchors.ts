import TableOfContents from '@tiptap/extension-table-of-contents'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, type PluginSpec } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return `h-${(hash >>> 0).toString(36)}-${occurrence}`
}

function renderedAnchors(doc: Node) {
  const occurrencesByText = new Map<string, number>()
  const decorations: Decoration[] = []
  const anchorHeading = (node: Node, pos: number) => {
    if (node.type.name !== 'heading') return

    if (!node.textContent || node.attrs['data-toc-id']) return false

    const occurrence = occurrencesByText.get(node.textContent) ?? 0
    occurrencesByText.set(node.textContent, occurrence + 1)
    const id = renderedId(node.textContent, occurrence)
    const attrs = {
      id,
      'data-toc-id': id,
    }
    const decoration = Decoration.node(pos, pos + node.nodeSize, attrs)
    decorations.push(decoration)
    return false
  }
  doc.descendants(anchorHeading)

  return DecorationSet.create(doc, decorations)
}

function withRenderedIds(anchors: Anchor[], scrollPosition: number) {
  if (anchors.every((anchor) => anchor.id)) return anchors

  const occurrencesByText = new Map<string, number>()
  const withId = (anchor: Anchor) => {
    let id = anchor.id
    if (!id) {
      const occurrence = occurrencesByText.get(anchor.textContent) ?? 0
      occurrencesByText.set(anchor.textContent, occurrence + 1)
      id = renderedId(anchor.textContent, occurrence)
    }
    return {
      ...anchor,
      id,
      isScrolledOver: scrollPosition >= anchor.dom.offsetTop,
    }
  }
  const anchorsWithIds = anchors.map(withId)
  const activeAnchor = anchorsWithIds.findLast((item) => item.isScrolledOver)
  return anchorsWithIds.map((item) => ({ ...item, isActive: item === activeAnchor }))
}

function anchorDecorationsPlugin() {
  const spec: PluginSpec<DecorationSet> = {
    key: new PluginKey('headingAnchorDecorations'),
    state: {
      init: (_config, state) => renderedAnchors(state.doc),
      apply: (tr, previousDecorations) =>
        tr.docChanged ? renderedAnchors(tr.doc) : previousDecorations,
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  }
  return new Plugin(spec)
}

export const HeadingAnchors = TableOfContents.extend({
  onBeforeCreate() {
    const callerOnUpdate = this.options.onUpdate
    this.options.onUpdate = (anchors, isInitial) => {
      const anchorsWithIds = withRenderedIds(anchors as Anchor[], this.storage.scrollPosition)
      callerOnUpdate?.(anchorsWithIds as never, isInitial)
    }
  },

  onCreate(event) {
    const { view } = this.editor
    const originalDispatch = view.dispatch
    view.dispatch = (tr) => {
      if (!tr.docChanged) {
        originalDispatch(tr)
      }
    }

    try {
      this.parent?.(event)
    } finally {
      view.dispatch = originalDispatch
    }
  },

  addProseMirrorPlugins() {
    return [...this.parent!(), anchorDecorationsPlugin()]
  },
})
