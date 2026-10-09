import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, type PluginSpec, type Transaction } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { Image as StockImage, Video as StockVideo } from 'frappe-ui/editor'

type Size = { width: number; height: number }

const HEAL = 'heal'

type Resolve = (size: Size) => void
type Reject = (error: unknown) => void

function measureImage(src: string) {
  const load = (resolve: Resolve, reject: Reject) => {
    const img = new globalThis.Image()
    img.onload = () => {
      const size: Size = {
        width: img.naturalWidth,
        height: img.naturalHeight,
      }
      resolve(size)
    }
    img.onerror = reject
    img.src = src
  }

  return new Promise<Size>(load)
}

function measureVideo(src: string) {
  const loadMetadata = (resolve: Resolve, reject: Reject) => {
    const video = document.createElement('video')

    const stop = () => {
      video.onloadedmetadata = video.onerror = null
      video.removeAttribute('src')
      video.load()
    }

    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const size: Size = {
        width: video.videoWidth,
        height: video.videoHeight,
      }
      resolve(size)
      stop()
    }
    video.onerror = (error) => {
      reject(error)
      stop()
    }
    video.src = src
  }

  return new Promise<Size>(loadMetadata)
}

// Undo, redo, a collaborator's change and content loaded without an update
// event are not the person's edits, nor is anything appended to them
function isOwnEdit(tr: Transaction) {
  if (!tr.docChanged) return false

  const root: Transaction = tr.getMeta('appendedTransaction') ?? tr
  const loaded = root.getMeta('preventUpdate')
  const undoneOrRedone = root.getMeta('history$')
  const healed = root.getMeta(HEAL)
  const received = root.getMeta(ySyncPluginKey)?.isChangeOrigin
  return !loaded && !undoneOrRedone && !healed && !received
}

// Sizes unsized media right after the person's own edit, in a transaction of
// its own: both undo histories decide per transaction, so only that keeps the
// sizes out of them. Opening or receiving a document writes nothing
export function healSizes(nodeName: string, measure: (src: string) => Promise<Size>) {
  const key = new PluginKey<number>(`${nodeName}Sizes`)
  const unsized = (node: Node) =>
    node.type.name === nodeName &&
    !!node.attrs.src &&
    !node.attrs.loading &&
    (node.attrs.width == null || node.attrs.height == null)

  const sources = (doc: Node) => {
    const found = new Set<string>()
    const collect = (node: Node) => {
      if (unsized(node)) {
        found.add(node.attrs.src)
      }
    }
    doc.descendants(collect)

    return found
  }

  // Outside the view: registering a plugin rebuilds every plugin view
  const measured = new Map<string, Size>()
  const measuring = new Set<string>()
  const owed = new Set<string>()
  let schedule = () => {}

  const measureAll = (doc: Node) => {
    for (const src of sources(doc)) {
      if (measured.has(src) || measuring.has(src)) continue

      const remember = (size: Size) => {
        measured.set(src, size)
        if (owed.has(src)) {
          schedule()
        }
      }

      measuring.add(src)
      measure(src)
        .then(remember)
        .catch(() => {})
        .finally(() => measuring.delete(src))
    }
  }

  const spec: PluginSpec<number> = {
    key,
    state: {
      init: () => 0,
      apply: (tr, edits) => (isOwnEdit(tr) ? edits + 1 : edits),
    },
    view(view) {
      let scheduled = false

      const flush = () => {
        scheduled = false
        if (view.isDestroyed) return

        const { tr } = view.state
        const fillSize = (node: Node, pos: number) => {
          const size = unsized(node) && owed.has(node.attrs.src) && measured.get(node.attrs.src)
          if (!size) return

          if (node.attrs.width == null) {
            tr.setNodeAttribute(pos, 'width', size.width)
          }
          if (node.attrs.height == null) {
            tr.setNodeAttribute(pos, 'height', size.height)
          }
        }
        tr.doc.descendants(fillSize)

        for (const src of measured.keys()) {
          owed.delete(src)
        }
        if (tr.docChanged) {
          tr.setMeta(HEAL, true)
          tr.setMeta('addToHistory', false)
          view.dispatch(tr)
        }
      }

      // After every plugin view has seen the edit, so Yjs sends the edit and the sizes apart
      schedule = () => {
        if (scheduled) return

        scheduled = true
        queueMicrotask(flush)
      }

      measureAll(view.state.doc)
      return {
        update(_view, previous) {
          if (view.state.doc.eq(previous.doc)) return

          if (key.getState(view.state) !== key.getState(previous)) {
            for (const src of sources(view.state.doc)) {
              owed.add(src)
            }
            schedule()
          }
          measureAll(view.state.doc)
        },
      }
    },
  }

  return new Plugin(spec)
}

// The stock plugin sizes unsized media after any change, so opening a
// document or receiving a collaborator's change would write
function withoutBackfill(stock: Plugin) {
  const spec: PluginSpec<unknown> = {
    ...stock.spec,
    appendTransaction: undefined,
  }
  return new Plugin(spec)
}

export const Image = StockImage.extend({
  addProseMirrorPlugins() {
    const [stock] = this.parent!()
    return [withoutBackfill(stock), healSizes(this.name, measureImage)]
  },
})

export const Video = StockVideo.extend({
  addProseMirrorPlugins() {
    const [stock] = this.parent!()
    return [withoutBackfill(stock), healSizes(this.name, measureVideo)]
  },
})
