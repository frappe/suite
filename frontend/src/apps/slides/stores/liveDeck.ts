// The live room of a converted presentation, for the old stores to reach. The stores
// keep changing what they always changed: this is where those changes turn into
// live writes instead of a row save
import type { AnyExtension } from '@tiptap/core'
import { ref, watch } from 'vue'

interface LiveSeat {
  push: () => void
  flush: () => void
  undo: () => void
  redo: () => void
  endStep: () => void
  /** Text whose position waits on a font: typing mustn't work one out from its fallback. */
  holdsPosition: (id: string) => boolean
  /** What ties a text editor to this element's live text. `seeded`: its first text was written now. */
  bindText: (id: string, seedHtml: string | null | undefined) => LiveTextBinding
}

interface LiveTextBinding {
  extensions: AnyExtension[]
  seeded: boolean
}

let seat: LiveSeat | null = null
const pushAsked = ref(0)
const renames = new Map<string, string>()
let boundId: string | null = null
let applyBoundText: ((html: string | null) => void) | null = null
let textEditedHere = false
let lastTextChangeHere = false

// Before any component draws: a new element takes its final id, so nothing mounts twice
watch(pushAsked, () => seat?.push(), { flush: 'pre' })

export const isLive = () => seat !== null

export function setLiveSeat(next: LiveSeat | null) {
  seat = next
  renames.clear()
  boundId = null
}

/** Called in place of marking the rows dirty. All changes of a tick go out as one. */
export function askLivePush() {
  pushAsked.value++
}

export const pushLiveNow = () => seat?.push()

export const flushLive = () => seat?.flush()

export const holdsPosition = (id: string) => seat?.holdsPosition(id) ?? false

export const undoLive = () => seat?.undo()

export const redoLive = () => seat?.redo()

/** The change just made is one undo step, and nothing after it joins that step. */
export const endLiveStep = () => seat?.endStep()

export function rememberRenames(renamed: Map<string, string>) {
  for (const [from, to] of renamed) {
    renames.set(from, to)
  }

  if (boundId) {
    boundId = renamed.get(boundId) ?? boundId
  }
}

/** The id an element has now. A write gives a new element a new id just after it is made. */
export const currentId = (id: string) => renames.get(id) ?? id

export const boundElementId = () => boundId

export const setBoundText = (html: string | null) => applyBoundText?.(html)

export function bindLiveText(
  id: string,
  seedHtml: string | null | undefined,
  applyText: (html: string | null) => void,
) {
  if (!seat) return null

  const { extensions, seeded } = seat.bindText(id, seedHtml)
  boundId = id
  applyBoundText = applyText
  // a shape's first text is written when its editor opens, and counts as this tab's edit
  textEditedHere = seeded
  lastTextChangeHere = seeded
  return extensions
}

export function unbindLiveText() {
  boundId = null
  applyBoundText = null
}

export const noteTextEdited = () => {
  textEditedHere = true
  lastTextChangeHere = true
}

export const noteTextReceived = () => {
  lastTextChangeHere = false
}

export const isTextEditedHere = () => textEditedHere

/** False once a co-editor's change or this tab's own undo is the newest thing in the open editor. */
export const wasLastTextChangeHere = () => lastTextChangeHere
