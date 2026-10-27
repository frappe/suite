import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type StateField } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import type { DocumentThread } from '@/apps/drive'

import { placeThread, type ThreadPlace } from './places'

/** Each thread's place in this tab, by thread name. */
export type ThreadPlaces = ReadonlyMap<string, ThreadPlace>

interface Highlights {
  places: ThreadPlaces
  decorations: DecorationSet
  // Mapped through an edit that Yjs doesn't have yet, to be placed again once it does
  isStale: boolean
}

interface HighlightOptions {
  threads: () => readonly DocumentThread[]
  // Told each time the threads are placed again
  onPlaced: (places: ThreadPlaces) => void
  // The thread open in the panel, whose text shows darker
  open: () => string | null
  // The thread whose row is pointed at, whose text shows a little darker
  lit: () => string | null
  // Told the thread whose highlighted text was clicked
  onOpened: (name: string) => void
}

interface Shown {
  open: string | null
  lit: string | null
}

const highlightsKey = new PluginKey<Highlights>('threadHighlights')

function highlightsState(
  threads: () => readonly DocumentThread[],
  shown: () => Shown,
): StateField<Highlights> {
  return {
    init: (_, state) => highlights(state, threads(), shown()),
    apply: (transaction, previous, _, state) => {
      if (transaction.getMeta(highlightsKey)) {
        return highlights(state, threads(), shown())
      }

      if (!transaction.docChanged) {
        return previous
      }

      const decorations = previous.decorations.map(transaction.mapping, transaction.doc)
      return { ...previous, decorations, isStale: true }
    },
  }
}

function placingView(view: EditorView, placed: (state: EditorState) => void) {
  placed(view.state)
  return {
    // The sync plugin's view writes an edit to Yjs before this one runs
    update: (updated: EditorView, previous: EditorState) => {
      const current = highlightsKey.getState(updated.state)!
      if (current.isStale) {
        redrawThreads(updated)
      } else if (current !== highlightsKey.getState(previous)) {
        placed(updated.state)
      }
    },
  }
}

/** Marks the text each open thread is on, found again after every change to the document. */
export const ThreadHighlights = Extension.create<HighlightOptions>({
  name: 'threadHighlights',

  addOptions() {
    return {
      threads: () => [],
      onPlaced: () => {},
      open: () => null,
      lit: () => null,
      onOpened: () => {},
    }
  },

  addProseMirrorPlugins() {
    const threads = () => this.options.threads()
    const shown = () => ({ open: this.options.open(), lit: this.options.lit() })
    const opened = (name: string) => this.options.onOpened(name)
    const placed = (state: EditorState) =>
      this.options.onPlaced(highlightsKey.getState(state)!.places)
    return [
      new Plugin({
        key: highlightsKey,
        state: highlightsState(threads, shown),
        props: {
          decorations: (state) => highlightsKey.getState(state)?.decorations,
          // The cursor still goes where the text was clicked
          handleClick: (_view, _position, event) => {
            const name = threadAt(event.target)
            if (name) {
              opened(name)
            }

            return false
          },
        },
        view: (view) => placingView(view, placed),
      }),
    ]
  },
})

/** Marks the threads again, once they are read from Drive. */
export function redrawThreads(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(highlightsKey, true))
}

/** Scrolls the editor to an open thread's text, only if none of it is in view. */
export function showThread(view: EditorView, name: string) {
  const spans = [...view.dom.querySelectorAll('[data-thread]')]
  const parts = spans.filter((span) => span.getAttribute('data-thread') === name)
  const [text] = parts
  const frame = text?.closest('#editor-scroll-container')
  if (!text || !frame || parts.some((part) => isInView(part, frame))) {
    return
  }

  text.scrollIntoView({ block: 'center' })
}

function isInView(text: Element, frame: Element) {
  const box = text.getBoundingClientRect()
  const view = frame.getBoundingClientRect()
  return box.bottom > view.top && box.top < view.bottom
}

function threadAt(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null
  }

  return target.closest('[data-thread]')?.getAttribute('data-thread') ?? null
}

function shownClass(name: string, shown: Shown) {
  if (name === shown.open) {
    return 'is-open'
  }

  if (name === shown.lit) {
    return 'is-lit'
  }

  return ''
}

function highlights(
  state: EditorState,
  threads: readonly DocumentThread[],
  shown: Shown,
): Highlights {
  const places = new Map<string, ThreadPlace>()
  const decorations: Decoration[] = []
  for (const thread of threads) {
    const place = placeThread(state, thread.anchor)
    places.set(thread.name, place)
    if (!thread.resolved && place.kind === 'text') {
      const attributes = { 'data-thread': thread.name, class: shownClass(thread.name, shown) }
      decorations.push(Decoration.inline(place.from, place.to, attributes))
    }
  }

  return { places, decorations: DecorationSet.create(state.doc, decorations), isStale: false }
}
