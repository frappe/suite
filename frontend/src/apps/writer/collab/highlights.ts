import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
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
  placed: (places: ThreadPlaces) => void
}

const highlightsKey = new PluginKey<Highlights>('threadHighlights')

/** Marks the text each open thread is on, found again after every change to the document. */
export const ThreadHighlights = Extension.create<HighlightOptions>({
  name: 'threadHighlights',

  addOptions() {
    return { threads: () => [], placed: () => {} }
  },

  addProseMirrorPlugins() {
    const threads = () => this.options.threads()
    const placed = (state: EditorState) =>
      this.options.placed(highlightsKey.getState(state)!.places)
    return [
      new Plugin({
        key: highlightsKey,
        state: {
          init: (_, state) => highlights(state, threads()),
          apply: (transaction, previous, _, state) => {
            if (transaction.getMeta(highlightsKey)) {
              return highlights(state, threads())
            }

            if (!transaction.docChanged) {
              return previous
            }

            const decorations = previous.decorations.map(transaction.mapping, transaction.doc)
            return { ...previous, decorations, isStale: true }
          },
        },
        props: {
          decorations: (state) => highlightsKey.getState(state)?.decorations,
        },
        view: (view) => {
          placed(view.state)
          return {
            // The sync plugin's view writes an edit to Yjs before this one runs
            update: (updated, previous) => {
              if (highlightsKey.getState(updated.state)!.isStale) {
                redrawThreads(updated)
              } else if (
                highlightsKey.getState(updated.state) !== highlightsKey.getState(previous)
              ) {
                placed(updated.state)
              }
            },
          }
        },
      }),
    ]
  },
})

/** Marks the threads again, once they are read from Drive. */
export function redrawThreads(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(highlightsKey, true))
}

function highlights(state: EditorState, threads: readonly DocumentThread[]): Highlights {
  const places = new Map<string, ThreadPlace>()
  const decorations: Decoration[] = []
  for (const thread of threads) {
    const place = placeThread(state, thread.anchor)
    places.set(thread.name, place)
    if (!thread.resolved && place.kind === 'text') {
      decorations.push(Decoration.inline(place.from, place.to, { 'data-thread': thread.name }))
    }
  }

  return { places, decorations: DecorationSet.create(state.doc, decorations), isStale: false }
}
