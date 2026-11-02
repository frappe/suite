import type { Node } from '@tiptap/pm/model'
import {
  Plugin,
  PluginKey,
  type EditorState,
  type PluginSpec,
  type Transaction,
} from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Image as StockImage, Video as StockVideo } from 'frappe-ui/editor'

import { isReceived } from './received-content-guard'
import { stockPlugin } from './stock-plugin'

interface Size {
  width: number
  height: number
}

const HEAL_META = 'heal'

type Resolve = (size: Size) => void
type Reject = (error: unknown) => void

function measureImage(src: string) {
  function loadImage(resolve: Resolve, reject: Reject) {
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

function releaseVideo(video: HTMLVideoElement) {
  video.onloadedmetadata = null
  video.onerror = null
  video.removeAttribute('src')
  video.load()
}

function measureVideo(src: string) {
  function loadMetadata(resolve: Resolve, reject: Reject) {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const size: Size = {
        width: video.videoWidth,
        height: video.videoHeight,
      }
      resolve(size)
      releaseVideo(video)
    }

    video.onerror = (error) => {
      reject(error)
      releaseVideo(video)
    }

    video.src = src
  }

  return new Promise<Size>(loadMetadata)
}

// Undo, redo, a collaborator's change and content loaded without an update
// event are not the person's edits, nor is anything appended to them
function isOwnEdit(tr: Transaction) {
  if (!tr.docChanged) {
    return false
  }

  const rootTransaction: Transaction = tr.getMeta('appendedTransaction') ?? tr
  const loaded = rootTransaction.getMeta('preventUpdate')
  const undoneOrRedone = rootTransaction.getMeta('history$')
  const healed = rootTransaction.getMeta(HEAL_META)
  return !loaded && !undoneOrRedone && !healed && !isReceived(rootTransaction)
}

interface Sizing {
  nodeName: string
  measure: (src: string) => Promise<Size>
  measuredSizes: Map<string, Size>
  measuringSources: Set<string>
  owedSources: Set<string>
  scheduleFill: () => void
}

function isUnsized(node: Node, nodeName: string) {
  return (
    node.type.name === nodeName &&
    !!node.attrs.src &&
    !node.attrs.loading &&
    (node.attrs.width == null || node.attrs.height == null)
  )
}

function unsizedSources(doc: Node, nodeName: string) {
  const sources = new Set<string>()
  function collectSource(node: Node) {
    if (isUnsized(node, nodeName)) {
      sources.add(node.attrs.src)
    }
  }

  doc.descendants(collectSource)

  return sources
}

async function measureSource(sizing: Sizing, src: string) {
  try {
    const size = await sizing.measure(src)
    sizing.measuredSizes.set(src, size)
    if (sizing.owedSources.has(src)) {
      sizing.scheduleFill()
    }
  } finally {
    sizing.measuringSources.delete(src)
  }
}

function measureAll(sizing: Sizing, doc: Node) {
  for (const src of unsizedSources(doc, sizing.nodeName)) {
    if (sizing.measuredSizes.has(src) || sizing.measuringSources.has(src)) continue

    sizing.measuringSources.add(src)
    void measureSource(sizing, src).catch(() => {})
  }
}

function fillOwedSizes(sizing: Sizing, view: EditorView) {
  if (view.isDestroyed) return

  const { tr } = view.state
  function fillSize(node: Node, pos: number) {
    const src = node.attrs.src
    const size =
      isUnsized(node, sizing.nodeName) &&
      sizing.owedSources.has(src) &&
      sizing.measuredSizes.get(src)
    if (!size) return

    if (node.attrs.width == null) {
      tr.setNodeAttribute(pos, 'width', size.width)
    }

    if (node.attrs.height == null) {
      tr.setNodeAttribute(pos, 'height', size.height)
    }
  }

  tr.doc.descendants(fillSize)

  for (const src of sizing.measuredSizes.keys()) {
    sizing.owedSources.delete(src)
  }

  if (tr.docChanged) {
    tr.setMeta(HEAL_META, true)
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)
  }
}

// After every plugin view has seen the edit, so Yjs sends the edit and the sizes apart
function fillScheduler(sizing: Sizing, view: EditorView) {
  let isFillScheduled = false
  function fill() {
    isFillScheduled = false
    fillOwedSizes(sizing, view)
  }

  return function scheduleFill() {
    if (isFillScheduled) return

    isFillScheduled = true
    queueMicrotask(fill)
  }
}

function sizesView(sizing: Sizing, key: PluginKey<number>, view: EditorView) {
  sizing.scheduleFill = fillScheduler(sizing, view)
  measureAll(sizing, view.state.doc)
  return {
    update(_view: EditorView, previousState: EditorState) {
      if (view.state.doc.eq(previousState.doc)) return

      if (key.getState(view.state) !== key.getState(previousState)) {
        for (const src of unsizedSources(view.state.doc, sizing.nodeName)) {
          sizing.owedSources.add(src)
        }

        sizing.scheduleFill()
      }

      measureAll(sizing, view.state.doc)
    },
  }
}

// Sizes unsized media right after the person's own edit, in a transaction of
// its own: both undo histories decide per transaction, so only that keeps the
// sizes out of them. Opening or receiving a document writes nothing
export function healSizes(nodeName: string, measure: (src: string) => Promise<Size>) {
  const key = new PluginKey<number>(`${nodeName}Sizes`)
  // Outside the view: registering a plugin rebuilds every plugin view
  const sizing: Sizing = {
    nodeName,
    measure,
    measuredSizes: new Map(),
    measuringSources: new Set(),
    owedSources: new Set(),
    scheduleFill: () => {},
  }
  const spec: PluginSpec<number> = {
    key,
    state: {
      init: () => 0,
      apply: (tr, ownEditCount) => {
        if (!isOwnEdit(tr)) {
          return ownEditCount
        }

        return ownEditCount + 1
      },
    },
    view: (view) => sizesView(sizing, key, view),
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
    const stock = stockPlugin(this.parent)
    return [withoutBackfill(stock), healSizes(this.name, measureImage)]
  },
})

export const Video = StockVideo.extend({
  addProseMirrorPlugins() {
    const stock = stockPlugin(this.parent)
    return [withoutBackfill(stock), healSizes(this.name, measureVideo)]
  },
})
