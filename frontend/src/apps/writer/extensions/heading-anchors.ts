import TableOfContents, {
  type TableOfContentData,
  type TableOfContentDataItem,
} from '@tiptap/extension-table-of-contents'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, type PluginSpec } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { nextTick } from 'vue'

// Opening or watching a document must never write to it. Ids are assigned
// only on the user's own edits; headings saved without one get an anchor drawn
// at render time instead

const HASH_MULTIPLIER = 31
const ID_RADIX = 36

function renderedId(text: string, occurrence: number) {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash * HASH_MULTIPLIER + text.charCodeAt(i)) | 0
  }

  const hashText = (hash >>> 0).toString(ID_RADIX)
  return `h-${hashText}-${occurrence}`
}

// Counts each heading text in document order, so repeated headings get ids of their own
export function renderedIds() {
  const occurrencesByText = new Map<string, number>()
  return function nextRenderedId(text: string) {
    const occurrence = occurrencesByText.get(text) ?? 0
    occurrencesByText.set(text, occurrence + 1)
    return renderedId(text, occurrence)
  }
}

function renderedAnchors(doc: Node) {
  const nextRenderedId = renderedIds()
  const decorations: Decoration[] = []
  function anchorHeading(node: Node, pos: number) {
    if (node.type.name !== 'heading') return

    if (!node.textContent || node.attrs['data-toc-id']) {
      return false
    }

    const id = nextRenderedId(node.textContent)
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

// A heading is active once it passes a line a third of the way down the view,
// so a section that fills the view is active before its heading reaches the top
const ACTIVE_LINE = 1 / 3

function viewOf(scrollParent: HTMLElement | Window) {
  if (scrollParent instanceof HTMLElement) {
    const { top, height } = scrollParent.getBoundingClientRect()
    const { scrollTop, clientHeight, scrollHeight } = scrollParent
    return {
      activeLine: top + height * ACTIVE_LINE,
      isAtBottom: scrollTop > 0 && scrollTop + clientHeight >= scrollHeight - 1,
    }
  }

  const { scrollY, innerHeight } = scrollParent
  return {
    activeLine: innerHeight * ACTIVE_LINE,
    isAtBottom: scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 1,
  }
}

// Headings in hidden tabs have no box, so they are never active
function withActiveStates(anchors: TableOfContentData, scrollParent: HTMLElement | Window | null) {
  const view = scrollParent && viewOf(scrollParent)
  function withState(anchor: TableOfContentDataItem) {
    const [box] = anchor.dom.getClientRects()
    const isScrolledOver = !!view && !!box && (view.isAtBottom || box.top <= view.activeLine)
    return { ...anchor, isScrolledOver }
  }

  const withStates = anchors.map(withState)
  const activeAnchor = withStates.findLast((anchor) => anchor.isScrolledOver)
  return withStates.map((anchor) => ({ ...anchor, isActive: anchor === activeAnchor }))
}

function withRenderedIds(anchors: TableOfContentData) {
  const nextRenderedId = renderedIds()
  return anchors.map((anchor) => ({
    ...anchor,
    id: anchor.id || nextRenderedId(anchor.textContent),
  }))
}

function anchorDecorationsPlugin() {
  const spec: PluginSpec<DecorationSet> = {
    key: new PluginKey('headingAnchorDecorations'),
    state: {
      init: (_config, state) => renderedAnchors(state.doc),
      apply: (tr, previousDecorations) => {
        if (!tr.docChanged) {
          return previousDecorations
        }

        return renderedAnchors(tr.doc)
      },
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
      const { scrollParent: option } = this.options
      const scrollParent = (typeof option === 'function' ? option() : option) ?? null
      const shownAnchors = withActiveStates(withRenderedIds(anchors), scrollParent)
      callerOnUpdate?.(shownAnchors, isInitial)
    }
  },

  // The stock onCreate writes ids into every heading, so its document changes are dropped
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

    // Opening at a tab, or changing tab, shows other headings with no scroll
    // or edit; Vue applies it a tick later
    const remeasure = () => void nextTick(() => this.storage.scrollHandler())
    remeasure()
    view.dom.addEventListener('tab-changed', remeasure)
  },

  addProseMirrorPlugins() {
    return [...this.parent!(), anchorDecorationsPlugin()]
  },
})
