import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, type PluginSpec, type Transaction } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { Image as StockImage, Video as StockVideo } from 'frappe-ui/editor'

type Size = { width: number; height: number }

const HEAL_META = 'heal'

type Resolve = (size: Size) => void
type Reject = (error: unknown) => void

function measureImage(src: string) {
  const loadImage = (resolve: Resolve, reject: Reject) => {
    const image = new globalThis.Image()
    image.onload = () => {
      const size: Size = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      }
      resolve(size)
    }
    image.onerror = reject
    image.src = src
  }

  return new Promise<Size>(loadImage)
}

function measureVideo(src: string) {
  const loadMetadata = (resolve: Resolve, reject: Reject) => {
    const video = document.createElement('video')

    const releaseVideo = () => {
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
      releaseVideo()
    }
    video.onerror = (error) => {
      reject(error)
      releaseVideo()
    }
    video.src = src
  }

  return new Promise<Size>(loadMetadata)
}

// Undo, redo, a collaborator's change and content loaded without an update
// event are not the person's edits, nor is anything appended to them
function isOwnEdit(tr: Transaction) {
  if (!tr.docChanged) return false

  const rootTransaction: Transaction = tr.getMeta('appendedTransaction') ?? tr
  const loaded = rootTransaction.getMeta('preventUpdate')
  const undoneOrRedone = rootTransaction.getMeta('history$')
  const healed = rootTransaction.getMeta(HEAL_META)
  const received = rootTransaction.getMeta(ySyncPluginKey)?.isChangeOrigin
  return !loaded && !undoneOrRedone && !healed && !received
}

// Sizes unsized media right after the person's own edit, in a transaction of
// its own: both undo histories decide per transaction, so only that keeps the
// sizes out of them. Opening or receiving a document writes nothing
export function healSizes(nodeName: string, measure: (src: string) => Promise<Size>) {
  const key = new PluginKey<number>(`${nodeName}Sizes`)
  const isUnsized = (node: Node) =>
    node.type.name === nodeName &&
    !!node.attrs.src &&
    !node.attrs.loading &&
    (node.attrs.width == null || node.attrs.height == null)

  const unsizedSources = (doc: Node) => {
    const sources = new Set<string>()
    const collectSource = (node: Node) => {
      if (isUnsized(node)) {
        sources.add(node.attrs.src)
      }
    }
    doc.descendants(collectSource)

    return sources
  }

  // Outside the view: registering a plugin rebuilds every plugin view
  const measuredSizes = new Map<string, Size>()
  const measuringSources = new Set<string>()
  const owedSources = new Set<string>()
  let scheduleFill = () => {}

  const measureAll = (doc: Node) => {
    for (const src of unsizedSources(doc)) {
      if (measuredSizes.has(src) || measuringSources.has(src)) continue

      const rememberSize = (size: Size) => {
        measuredSizes.set(src, size)
        if (owedSources.has(src)) {
          scheduleFill()
        }
      }

      measuringSources.add(src)
      measure(src)
        .then(rememberSize)
        .catch(() => {})
        .finally(() => measuringSources.delete(src))
    }
  }

  const spec: PluginSpec<number> = {
    key,
    state: {
      init: () => 0,
      apply: (tr, ownEditCount) => (isOwnEdit(tr) ? ownEditCount + 1 : ownEditCount),
    },
    view(view) {
      let isFillScheduled = false

      const fillOwedSizes = () => {
        isFillScheduled = false
        if (view.isDestroyed) return

        const { tr } = view.state
        const fillSize = (node: Node, pos: number) => {
          const size =
            isUnsized(node) && owedSources.has(node.attrs.src) && measuredSizes.get(node.attrs.src)
          if (!size) return

          if (node.attrs.width == null) {
            tr.setNodeAttribute(pos, 'width', size.width)
          }
          if (node.attrs.height == null) {
            tr.setNodeAttribute(pos, 'height', size.height)
          }
        }
        tr.doc.descendants(fillSize)

        for (const src of measuredSizes.keys()) {
          owedSources.delete(src)
        }
        if (tr.docChanged) {
          tr.setMeta(HEAL_META, true)
          tr.setMeta('addToHistory', false)
          view.dispatch(tr)
        }
      }

      // After every plugin view has seen the edit, so Yjs sends the edit and the sizes apart
      scheduleFill = () => {
        if (isFillScheduled) return

        isFillScheduled = true
        queueMicrotask(fillOwedSizes)
      }

      measureAll(view.state.doc)
      return {
        update(_view, previousState) {
          if (view.state.doc.eq(previousState.doc)) return

          if (key.getState(view.state) !== key.getState(previousState)) {
            for (const src of unsizedSources(view.state.doc)) {
              owedSources.add(src)
            }
            scheduleFill()
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
function withoutBackfill(stockPlugin: Plugin) {
  const spec: PluginSpec<unknown> = {
    ...stockPlugin.spec,
    appendTransaction: undefined,
  }
  return new Plugin(spec)
}

export const Image = StockImage.extend({
  addProseMirrorPlugins() {
    const [stockPlugin] = this.parent!()
    return [withoutBackfill(stockPlugin), healSizes(this.name, measureImage)]
  },
})

export const Video = StockVideo.extend({
  addProseMirrorPlugins() {
    const [stockPlugin] = this.parent!()
    return [withoutBackfill(stockPlugin), healSizes(this.name, measureVideo)]
  },
})
