import { Extension } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

interface Measured {
  transaction: Transaction
  top: number
}

interface Storage {
  scroller: HTMLElement | null
  measured: Measured | null
  leftover: number
  isDragging: boolean
  stop: (() => void) | null
}

function isOthersEdit(transaction: Transaction) {
  const sync = transaction.getMeta(ySyncPluginKey)
  return transaction.docChanged && !!sync?.isChangeOrigin && !sync.isUndoRedoOperation
}

// A sideways scroller reads as overflow-y auto too, so only one with content below its fold counts
function isScrollingDown(element: HTMLElement) {
  const isScrollable = /auto|scroll/.test(getComputedStyle(element).overflowY)
  return isScrollable && element.scrollHeight > element.clientHeight
}

function scrollerOf(element: HTMLElement) {
  let parent = element.parentElement
  while (parent && !isScrollingDown(parent)) {
    parent = parent.parentElement
  }

  return parent
}

function caretTop(view: EditorView) {
  return view.coordsAtPos(view.state.selection.head).top
}

// The scroller's visible band, or the window's while the doc still fits
function sightOf(scroller: HTMLElement | null) {
  if (scroller) {
    return scroller.getBoundingClientRect()
  }

  return { top: 0, bottom: window.innerHeight }
}

// Where this tab's caret sits on screen before others' edit lands, kept for that edit alone
function measure(storage: Storage, view: EditorView, transaction: Transaction) {
  if (storage.isDragging || !isOthersEdit(transaction)) return

  storage.scroller ??= scrollerOf(view.dom)
  const sight = sightOf(storage.scroller)
  const top = caretTop(view)
  const isInSight = top >= sight.top && top <= sight.bottom
  if (isInSight) {
    storage.measured = { transaction, top }
  }
}

// The scroller keeps whole pixels, so the dropped fraction carries over, never a clamp's shortfall
function shift(storage: Storage, scroller: HTMLElement, by: number) {
  const target = scroller.scrollTop + by + storage.leftover
  scroller.scrollTop = target
  const rest = target - scroller.scrollTop
  storage.leftover = 0
  if (Math.abs(rest) < 1) {
    storage.leftover = rest
  }
}

function listenForDrags(storage: Storage, dom: HTMLElement) {
  function onPointerDown() {
    storage.isDragging = true
  }

  function onPointerUp() {
    storage.isDragging = false
  }

  dom.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  return () => {
    dom.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerup', onPointerUp)
  }
}

// Keeps this tab's own line where it is on screen while others edit above it, scrolled or not
export const SteadyCaret = Extension.create<object, Storage>({
  name: 'steadyCaret',

  addStorage() {
    return { scroller: null, measured: null, leftover: 0, isDragging: false, stop: null }
  },

  onCreate() {
    const storage = this.storage
    const view = this.editor.view
    function onBeforeTransaction({ transaction }: { transaction: Transaction }) {
      measure(storage, view, transaction)
    }

    this.editor.on('beforeTransaction', onBeforeTransaction)
    const stopDrags = listenForDrags(storage, view.dom)
    storage.stop = () => {
      this.editor.off('beforeTransaction', onBeforeTransaction)
      stopDrags()
    }
  },

  // Plugins dispatch their own transactions while the edit lands, so only the measured one scrolls
  onTransaction({ transaction }) {
    const measured = this.storage.measured
    if (measured?.transaction !== transaction) return

    this.storage.measured = null
    this.storage.scroller ??= scrollerOf(this.editor.view.dom)
    if (!this.storage.scroller) return

    shift(this.storage, this.storage.scroller, caretTop(this.editor.view) - measured.top)
  },

  onDestroy() {
    this.storage.stop?.()
  },
})
