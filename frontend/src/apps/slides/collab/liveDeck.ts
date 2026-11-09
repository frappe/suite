// Keeps the slide store and a converted presentation's live document the same. The
// old editing code keeps changing the store: a push finds what it changed and writes
// only that. A change from anyone else is merged into the store in place, so what is
// on screen keeps its identity and nothing goes back to the document
//
// The store holds centred text flattened to top-left, in memory only: the mirror
// holds that form too, so opening writes nothing and the first edit saves top-left

import { createDocument } from '@tiptap/core'
import { prosemirrorToYXmlFragment, ySyncPluginKey } from '@tiptap/y-tiptap'
import { toRaw } from 'vue'
import * as Y from 'yjs'

import {
  addBlankIfEmpty,
  addElement,
  addSlide,
  deleteElement,
  deleteSlide,
  ELEMENT_FIELDS,
  elementOrders,
  elementText,
  moveElement,
  moveSlide,
  ROOT,
  setElement,
  setSlide,
  SLIDE_FIELDS,
  slideOrders,
} from './deck'
import { deckSchema, drawnSlides } from './drawnDeck'
import { openLiveUndo, type StepDirection } from './liveUndo'

const LIVE_ORIGIN = 'slides-live-store'
// Opening an editor isn't an edit, so this write is no undo step
const SEED_ORIGIN = 'slides-live-seed'

const LOCAL_ORIGINS = new Set<unknown>([LIVE_ORIGIN, SEED_ORIGIN, ySyncPluginKey])
const CENTRED = 'translate(-50%, -50%)'
const FRAME_KEYS = ['left', 'top', 'width', 'height', 'transform', 'transformOrigin']
const DRAWN_ELEMENT_KEYS = new Set([...ELEMENT_FIELDS, ...FRAME_KEYS, 'connector', 'content'])
const DRAWN_SLIDE_KEYS = SLIDE_FIELDS

export type StoreItem = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface StoreSlide extends StoreItem {
  clientId: string
  elements: StoreItem[]
}

/** What the live document needs from the page around it. */
export interface LiveDeckHost {
  slides: () => StoreSlide[]
  /** The element as this tab draws it: centred text comes back with a top-left position. */
  flatten: (element: StoreItem) => StoreItem
  /** The element whose text a live editor holds. Its text never goes through the store. */
  boundElementId: () => string | null
  /** Whether this tab has the slide or element selected. It is what a reorder just moved. */
  isSelected: (id: string) => boolean
  /** Text the store set on that element from outside the editor: a column resize, say. */
  setBoundText: (html: string | null) => void
  canWrite: () => boolean
  /** A font is still loading, so a top-left `flatten` works out now is only good for drawing. */
  fontsPending: () => boolean
  onRenamed: (renames: Map<string, string>) => void
  onMerged: (previousSlideIds: string[]) => void
  onStep: (step: LiveStep) => void
  /** Someone else deleted the element this tab is typing in. Its text is still in the store. */
  onBoundDeleted: (id: string) => void
}

/** What one press of undo or redo did, and where it should land. */
export interface LiveStep {
  direction: StepDirection
  isBlocked: boolean
  slideId: string | null
  elementIds: string[]
}

/** The store as last matched to the document, one JSON string per item. */
interface Mirror {
  slides: Map<string, string>
  elements: Map<string, string>
  slideOrder: string[]
  elementOrders: Map<string, string[]>
}

function stacked(elements: StoreItem[]) {
  return [...elements].sort((one, other) => (one.zIndex || 1) - (other.zIndex || 1))
}

function mirrorOf(slides: StoreSlide[]): Mirror {
  const mirror: Mirror = {
    slides: new Map(),
    elements: new Map(),
    slideOrder: [],
    elementOrders: new Map(),
  }

  // raw, as reading through Vue's proxies on every keystroke is slow on a long presentation
  for (const { clientId, elements, ...fields } of toRaw(slides).map(toRaw)) {
    mirror.slides.set(clientId, JSON.stringify(fields))
    mirror.slideOrder.push(clientId)
    const inStack = stacked(toRaw(elements).map(toRaw))
    mirror.elementOrders.set(
      clientId,
      inStack.map(({ id }) => id),
    )
    for (const element of inStack) {
      mirror.elements.set(element.id, JSON.stringify(element))
    }
  }

  return mirror
}

function sameValue(one: unknown, other: unknown) {
  return one === other || JSON.stringify(one) === JSON.stringify(other)
}

function slideFields(slide: StoreItem) {
  return Object.fromEntries(Object.entries(slide).filter(([key]) => SLIDE_FIELDS.has(key)))
}

function elementFields(element: StoreItem) {
  const fields: StoreItem = Object.fromEntries(
    Object.entries(element).filter(([key]) => ELEMENT_FIELDS.has(key)),
  )
  const frame = FRAME_KEYS.flatMap((key) =>
    element[key] === undefined ? [] : [[key, element[key]]],
  )
  fields.frame = Object.fromEntries(frame)
  fields.connectorStart = element.connector?.start
  fields.connectorEnd = element.connector?.end
  fields.route = element.connector?.route
  return fields
}

function changedFields(before: StoreItem, now: StoreItem) {
  const keys = new Set([...Object.keys(before), ...Object.keys(now)])
  const changed = [...keys].flatMap((key) =>
    sameValue(before[key], now[key]) ? [] : [[key, now[key]]],
  )
  return Object.fromEntries(changed)
}

// Diffs into the fragment, so a co-editor's letters in the same element stay (Q21)
function writeText(doc: Y.Doc, id: string, html: string | null | undefined) {
  const fragment = elementText(doc, id)
  if (!fragment) {
    return
  }

  if (html == null) {
    fragment.delete(0, fragment.length)
    return
  }

  prosemirrorToYXmlFragment(
    createDocument(html, deckSchema, { preserveWhitespace: true }),
    fragment,
  )
}

// The most ids that are already in the right order, which then don't need a new order value
function alreadyInOrder(wanted: string[], current: string[]) {
  const positions = new Map(current.map((id, at) => [id, at]))
  const longest = wanted.map(() => 1)
  const cameFrom = wanted.map(() => -1)
  let best = -1

  wanted.forEach((id, at) => {
    for (let earlier = 0; earlier < at; earlier++) {
      const isAfter = positions.get(wanted[earlier])! < positions.get(id)!
      if (isAfter && longest[earlier] + 1 > longest[at]) {
        longest[at] = longest[earlier] + 1
        cameFrom[at] = earlier
      }
    }

    if (best === -1 || longest[at] > longest[best]) {
      best = at
    }
  })

  const staying = new Set<string>()
  for (let at = best; at !== -1; at = cameFrom[at]) {
    staying.add(wanted[at])
  }

  return staying
}

function placesAmong(order: string[], others: Set<string>) {
  const places = new Map<string, number>()
  let passed = 0
  for (const id of order) {
    if (others.has(id)) {
      passed++
    } else {
      places.set(id, passed)
    }
  }

  return places
}

// Orders alone can't tell what moved. While the others keep their order, a selected item
// moved (Q17) unless it still sits among the same others
function itemsToKeep(present: string[], current: string[], isSelected: (id: string) => boolean) {
  const others = present.filter((id) => !isSelected(id))
  if (alreadyInOrder(others, current).size !== others.length) {
    return alreadyInOrder(present, current)
  }

  const notSelected = new Set(others)
  const placesBefore = placesAmong(current, notSelected)
  const placesNow = placesAmong(present, notSelected)
  const settled = present.filter(
    (id) => notSelected.has(id) || placesBefore.get(id) === placesNow.get(id),
  )

  return alreadyInOrder(settled, current)
}

// Nothing fits between two equal orders, so a tie with a moved item inside it can't all stay
// The longest unbroken run of each value keeps it, which is the fewest extra writes
function releaseSplitTies(staying: Set<string>, present: string[], orders: Map<string, string>) {
  const runs = new Map<string, string[][]>()
  let open: string | null = null
  for (const id of present) {
    if (!staying.has(id)) {
      open = null
      continue
    }

    const value = orders.get(id) ?? ''
    if (value !== open) {
      runs.set(value, [...(runs.get(value) ?? []), []])
      open = value
    }

    runs.get(value)?.at(-1)?.push(id)
  }

  for (const tied of runs.values()) {
    const longest = tied.reduce((best, run) => (run.length > best.length ? run : best))
    for (const id of tied.filter((run) => run !== longest).flat()) {
      staying.delete(id)
    }
  }
}

function writeOrder(
  wanted: string[],
  orders: Map<string, string>,
  move: (id: string, afterId: string | null) => void,
  isSelected: (id: string) => boolean,
) {
  const present = wanted.filter((id) => orders.has(id))
  const staying = itemsToKeep(present, [...orders.keys()], isSelected)
  releaseSplitTies(staying, present, orders)
  let previous: string | null = null
  for (const id of present) {
    if (!staying.has(id)) {
      move(id, previous)
    }

    previous = id
  }
}

function assignChanged(target: StoreItem, source: StoreItem, mergedKeys: Set<string>) {
  const raw = toRaw(target)
  for (const [key, value] of Object.entries(source)) {
    if (!sameValue(raw[key], value)) {
      target[key] = value
    }
  }

  for (const key of mergedKeys) {
    if (key in raw && !(key in source)) {
      delete target[key]
    }
  }
}

function replaceIfDifferent<T>(list: T[], next: T[]) {
  if (list.length !== next.length || list.some((item, at) => item !== next[at])) {
    list.splice(0, list.length, ...next)
  }
}

export function openLiveDeck(doc: Y.Doc, host: LiveDeckHost) {
  const htmlById = new Map<string, string>()
  const steps = openLiveUndo(doc, [LIVE_ORIGIN, ySyncPluginKey])
  let mirror = mirrorOf(host.slides())
  let reportedGoneId: string | null = null

  function forEachStoreElement(visit: (element: StoreItem) => void) {
    for (const slide of host.slides()) {
      slide.elements.forEach(visit)
    }
  }

  function renameInStore(renames: Map<string, string>) {
    for (const slide of host.slides()) {
      slide.clientId = renames.get(slide.clientId) ?? slide.clientId
    }

    forEachStoreElement((element) => {
      element.id = renames.get(element.id) ?? element.id
      for (const end of [element.connector?.start, element.connector?.end]) {
        if (renames.has(end?.elementId)) {
          end.elementId = renames.get(end.elementId)
        }
      }
    })

    host.onRenamed(renames)
  }

  function removeGone(now: Mirror) {
    const goneSlides = [...mirror.slides.keys()].filter((id) => !now.slides.has(id))
    const goneElements = [...mirror.elements.keys()].filter((id) => !now.elements.has(id))
    steps.keep('slides', goneSlides)
    steps.keep('elements', goneElements)
    goneSlides.forEach((id) => deleteSlide(doc, id))
    goneElements.forEach((id) => deleteElement(doc, id))
  }

  // A new item is written bare and takes the id the write made. Its fields then
  // go out as changes, so connector ends carry the new ids (Q3, Q28)
  function createNew(now: Mirror) {
    const renames = new Map<string, string>()
    for (const oldId of now.slideOrder) {
      if (!mirror.slides.has(oldId)) {
        const id = addSlide(doc)
        renames.set(oldId, id)
        mirror.slides.set(id, '{}')
      }
    }

    for (const oldSlideId of now.slideOrder) {
      const slideId = renames.get(oldSlideId) ?? oldSlideId
      for (const oldId of now.elementOrders.get(oldSlideId)!) {
        if (!mirror.elements.has(oldId)) {
          const { type } = JSON.parse(now.elements.get(oldId)!)
          const id = addElement(doc, slideId, { type })
          renames.set(oldId, id)
          mirror.elements.set(id, JSON.stringify({ type }))
        }
      }
    }

    return renames
  }

  function savedFrame(id: string) {
    return doc.getMap<Y.Map<StoreItem>>(ROOT.elements).get(id)?.get('frame')
  }

  function writeChanged(now: Mirror) {
    for (const [id, json] of now.slides) {
      const before = mirror.slides.get(id)!
      if (json !== before) {
        setSlide(
          doc,
          id,
          changedFields(slideFields(JSON.parse(before)), slideFields(JSON.parse(json))),
        )
      }
    }

    let boundText: { html: string | null } | null = null
    for (const [id, json] of now.elements) {
      const previous = mirror.elements.get(id)!
      if (json === previous) continue
      const [before, after] = [JSON.parse(previous), JSON.parse(json)]
      const fields = changedFields(elementFields(before), elementFields(after))
      const isEdited = Object.keys(fields).length > 0 || !sameValue(before.content, after.content)
      const isFlattened = savedFrame(id)?.transform === CENTRED && after.transform !== CENTRED
      if (isEdited && isFlattened && !host.fontsPending()) {
        fields.frame = elementFields(after).frame
      }

      setElement(doc, id, fields)
      if (sameValue(before.content, after.content)) continue
      if (id === host.boundElementId()) {
        boundText = { html: after.content ?? null }
      } else {
        writeText(doc, id, after.content)
      }
    }

    return boundText
  }

  function writeOrders(now: Mirror) {
    if (!sameValue(now.slideOrder, mirror.slideOrder)) {
      const move = (id: string, afterId: string | null) => moveSlide(doc, id, afterId)
      writeOrder(now.slideOrder, slideOrders(doc), move, host.isSelected)
    }

    for (const [slideId, wanted] of now.elementOrders) {
      if (!sameValue(wanted, mirror.elementOrders.get(slideId))) {
        const move = (id: string, afterId: string | null) => moveElement(doc, id, afterId)
        writeOrder(wanted, elementOrders(doc, slideId), move, host.isSelected)
      }
    }
  }

  // Typing changes a centred element's height, so its top-left is worked out again
  // Moved by hand, it keeps where it was put and saves that
  function reflattenBound() {
    const boundId = host.boundElementId()
    const element = host
      .slides()
      .flatMap((slide) => slide.elements)
      .find(({ id }) => id === boundId)
    const previous = boundId && mirror.elements.get(boundId)
    if (!element || !previous) {
      return
    }

    const frame = savedFrame(element.id)
    const before = JSON.parse(previous)
    const isHeld = element.left === before.left && element.top === before.top
    if (!isHeld || frame?.transform !== CENTRED) {
      return
    }

    const { left, top } = host.flatten({ ...toRaw(element), ...frame })
    if (host.fontsPending()) {
      return
    }

    element.left = left
    element.top = top
  }

  function push() {
    if (!host.canWrite()) {
      return
    }

    reflattenBound()
    let now = mirrorOf(host.slides())
    let boundText: { html: string | null } | null = null
    steps.write(() => {
      doc.transact(() => {
        removeGone(now)
        const renames = createNew(now)
        if (renames.size) {
          renameInStore(renames)
          now = mirrorOf(host.slides())
        }

        boundText = writeChanged(now)
        writeOrders(now)
      }, LIVE_ORIGIN)
    })
    mirror = now
    if (boundText) {
      host.setBoundText(boundText.html)
    }
  }

  function merge() {
    const store = host.slides()
    const previousIds = store.map(({ clientId }) => clientId)
    const slideById = new Map(store.map((slide) => [slide.clientId, slide]))
    const next = drawnSlides(doc, htmlById).map((drawn) => {
      const flat = drawn.elements.map(host.flatten)
      const slide = slideById.get(drawn.clientId)
      if (!slide) {
        return { ...drawn, elements: flat }
      }

      const elementById = new Map(slide.elements.map((element) => [element.id, element]))
      const elements = flat.map((element) => {
        const existing = elementById.get(element.id)
        if (!existing) {
          return element
        }

        assignChanged(existing, element, DRAWN_ELEMENT_KEYS)
        return existing
      })
      const { elements: _elements, ...fields } = drawn
      assignChanged(slide, fields, DRAWN_SLIDE_KEYS)
      replaceIfDifferent(slide.elements, elements)
      return slide
    })

    replaceIfDifferent<StoreSlide>(store, next)
    mirror = mirrorOf(store)
    host.onMerged(previousIds)
  }

  function pull() {
    push()
    merge()
    // the one write a remote change can cause (Q27)
    if (host.canWrite()) {
      addBlankIfEmpty(doc)
    }
  }

  // Before the merge takes the element out of the store, along with what was typed in it
  function reportBoundGone() {
    const boundId = host.boundElementId()
    if (!boundId || elementsRoot.has(boundId)) {
      reportedGoneId = null
      return
    }

    if (boundId !== reportedGoneId) {
      reportedGoneId = boundId
      host.onBoundDeleted(boundId)
    }
  }

  function onUpdate(_update: Uint8Array, origin: unknown) {
    if (LOCAL_ORIGINS.has(origin)) {
      return
    }

    // Q38: an item that comes back whole, not a write of the remote change's own
    if (host.canWrite()) {
      steps.writeBackOwn()
    }

    if (origin !== steps.manager) {
      reportBoundGone()
    }

    pull()
  }

  function elementPlaces() {
    return new Map(
      host
        .slides()
        .flatMap(({ clientId, elements }) => elements.map(({ id }) => [id, clientId] as const)),
    )
  }

  function landing(slideIds: string[], elementIds: string[], placesBefore: Map<string, string>) {
    const shownSlide = slideIds.find((id) => host.slides().some((s) => s.clientId === id))
    if (shownSlide) {
      return { slideId: shownSlide, elementIds: [] }
    }

    const places = elementPlaces()
    const shown = elementIds.filter((id) => places.has(id))
    if (shown.length) {
      const slideId = places.get(shown[0])!
      return { slideId, elementIds: shown.filter((id) => places.get(id) === slideId) }
    }

    const removed = elementIds.find((id) => placesBefore.has(id))
    return { slideId: removed ? placesBefore.get(removed)! : null, elementIds: [] }
  }

  function takeStep(direction: StepDirection) {
    if (!host.canWrite()) {
      return
    }

    push()
    const placesBefore = elementPlaces()
    const step = steps.take(direction)
    if (step) {
      host.onStep({
        direction,
        isBlocked: step.isBlocked,
        ...landing(step.slideIds, step.elementIds, placesBefore),
      })
    }
  }

  function forgetChangedText(events: Y.YEvent<Y.AbstractType<unknown>>[]) {
    for (const event of events) {
      const [changedId] = event.path
      if (typeof changedId === 'string') {
        htmlById.delete(changedId)
        continue
      }

      event.changes.keys.forEach((_change, id) => htmlById.delete(id))
    }
  }

  const elementsRoot = doc.getMap(ROOT.elements)
  elementsRoot.observeDeep(forgetChangedText)
  doc.on('update', onUpdate)
  pull()

  return {
    /** Sends whatever the store changed since the last push or merge. */
    push,
    /** Draws the document again without writing to it. Send the store's changes first. */
    redraw: merge,
    holdsPosition: (id: string) => savedFrame(id)?.transform === CENTRED && host.fontsPending(),
    undo: () => takeStep('undo'),
    redo: () => takeStep('redo'),
    /** The change just made is one undo step, and nothing after it joins that step. */
    endStep: steps.endStep,
    undoManager: steps.manager,
    /** An element's first text, written when its editor opens. */
    seedText(id: string, html: string) {
      doc.transact(() => writeText(doc, id, html), SEED_ORIGIN)
    },
    stop() {
      doc.off('update', onUpdate)
      elementsRoot.unobserveDeep(forgetChangedText)
      steps.stop()
    },
  }
}

export type LiveDeck = ReturnType<typeof openLiveDeck>
