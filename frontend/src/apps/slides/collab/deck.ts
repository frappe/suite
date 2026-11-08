// The Y.Doc layout for one deck. Everything that reads or writes the collab
// doc goes through here, so the spelling lives in one place (the server
// registration in suite/slides/content mirrors it)
//
// Layout (one Y.Doc per deck):
//
//   slides   Y.Map   slide id → Y.Map of SLIDE_KEYS
//   boxes    Y.Map   box id → Y.Map of BOX_KEYS
//
// Flat, with no nesting: `parent` names a box's slide. `order` is a string
// compared by code unit, ties broken by id, so a move writes one value on the
// moved item and a gap never runs out. `frame` holds position, size and the
// centred form as one value, so two tabs can't mix them. `text` is a Y.XmlFragment
// holding the box's rich text. The doc holds no Y.Array and no Y.Text

import * as Y from 'yjs'

import { randomId } from '@/platform/random-id'

export const ROOT = { slides: 'slides', boxes: 'boxes' } as const

export const SLIDE_FIELDS = new Set([
  'background',
  'transition',
  'transitionDuration',
  'fadeUnmatchedElements',
  'advanceAfter',
])

export const BOX_FIELDS = new Set([
  'type',
  'frame',
  'rotation',
  'opacity',
  'locked',
  'refId',
  // shapes and lines
  'shapeType',
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'strokeStyle',
  'markerStart',
  'markerEnd',
  'points',
  'connectorStart',
  'connectorEnd',
  'route',
  // borders and shadows
  'borderStyle',
  'borderWidth',
  'borderColor',
  'borderRadius',
  'shadowColor',
  'shadowOpacity',
  'shadowBlur',
  'shadowOffset',
  'shadowAngle',
  // images and videos
  'src',
  'poster',
  'crop',
  'attachmentName',
  'useTemplateDimensions',
  'invertX',
  'invertY',
  'autoplay',
  'loop',
  'playbackRate',
  // text and tables
  'lineHeight',
  'color',
  'bandColor',
  'bandedRows',
  'gridColor',
  'gridWidth',
])

export const SLIDE_KEYS = ['order', ...SLIDE_FIELDS]
export const BOX_KEYS = ['parent', 'order', 'text', ...BOX_FIELDS]

export const BOX_TYPES = new Set(['text', 'image', 'video', 'shape', 'table'])
export const TYPES_WITH_TEXT = new Set(['text', 'shape', 'table'])

type Item = Y.Map<unknown>
type Fields = Record<string, unknown>
interface Sibling {
  id: string
  item: Item
}

export interface DeckItem {
  id: string
  [field: string]: unknown
}

export interface DeckSlide extends DeckItem {
  boxes: DeckItem[]
}

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const LAST_DIGIT = DIGITS.length - 1
const FIRST_ORDER = 'V'
const HALVES = 2
const SORTS_BEFORE = -1
const SORTS_AFTER = 1
const NOT_FIELDS = new Set(['order', 'parent', 'text'])
const CONNECTOR_ENDS = ['connectorStart', 'connectorEnd']
export const DRAWN_BLANK = 'drawn-blank'

// Undo can restore an item without a key a co-editor changed. No order sorts
// first, then by id, so every tab agrees until ticket 53's write-back
function orderOf(item: Item) {
  return (item.get('order') ?? '') as string
}

function slidesOf(doc: Y.Doc): Y.Map<Item> {
  return doc.getMap(ROOT.slides)
}

function boxesOf(doc: Y.Doc): Y.Map<Item> {
  return doc.getMap(ROOT.boxes)
}

function orderPast(lo: string): string {
  if (!lo) {
    return FIRST_ORDER
  }

  const digit = DIGITS.indexOf(lo[0])
  if (digit === LAST_DIGIT) {
    return lo[0] + orderPast(lo.slice(1))
  }

  return DIGITS[digit + 1]
}

// A string after lo and before hi (null: no upper end). lo < hi, and neither
// ends in the lowest digit, so there is always room below a value
function orderBetween(lo: string, hi: string | null): string {
  if (hi === null) {
    return orderPast(lo)
  }

  let shared = 0
  while ((lo[shared] ?? DIGITS[0]) === hi[shared]) {
    shared++
  }

  if (shared) {
    return hi.slice(0, shared) + orderBetween(lo.slice(shared), hi.slice(shared))
  }

  const low = DIGITS.indexOf(lo[0] ?? DIGITS[0])
  const high = DIGITS.indexOf(hi[0])
  if (high - low > 1) {
    return DIGITS[Math.round((low + high) / HALVES)]
  }

  if (hi.length > 1) {
    return hi[0]
  }

  return DIGITS[low] + orderPast(lo.slice(1))
}

function inOrder(entries: [string, Item][]): Sibling[] {
  const siblings = entries.map(([id, item]) => ({ id, item }))

  return siblings.sort((one, other) => {
    const [oneOrder, otherOrder] = [orderOf(one.item), orderOf(other.item)]
    if (oneOrder !== otherOrder) {
      return oneOrder < otherOrder ? SORTS_BEFORE : SORTS_AFTER
    }

    return one.id < other.id ? SORTS_BEFORE : SORTS_AFTER
  })
}

function slidesInOrder(doc: Y.Doc) {
  return inOrder([...slidesOf(doc).entries()])
}

function boxesInOrder(doc: Y.Doc, slideId: string) {
  return inOrder([...boxesOf(doc).entries()].filter(([, box]) => box.get('parent') === slideId))
}

// The order that puts an item right after afterId. Null means first. An id that
// is gone, as when another tab just deleted it, means last. Items tied with
// afterId share its value, so the item lands after all of them
function orderAfter(siblings: Sibling[], afterId: string | null) {
  const found = siblings.find(({ id }) => id === afterId) ?? siblings.at(-1)
  const after = afterId === null ? undefined : found
  const lo = (after?.item.get('order') ?? '') as string
  const next = siblings.find(({ item }) => orderOf(item) > lo)

  return orderBetween(lo, (next?.item.get('order') ?? null) as string | null)
}

function orderOnTop(siblings: Sibling[]) {
  return orderAfter(siblings, siblings.at(-1)?.id ?? null)
}

// A box under the drawn blank would stay hidden for good, on every tab, since
// that slide never exists. The tab adds a real slide first
function refuseDrawnBlank(parent: string) {
  if (parent === DRAWN_BLANK) {
    throw new Error('Add a slide before adding to the drawn blank')
  }
}

// A name outside the declared set would get the whole push refused, so it
// stops here, in the tab that made the mistake
function writeFields(item: Item, fields: Fields, declared: Set<string>) {
  for (const key of Object.keys(fields)) {
    if (!declared.has(key)) {
      throw new Error(`Not a deck field: ${key}`)
    }
  }

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      item.delete(key)
    } else {
      item.set(key, value)
    }
  }
}

// A whole old deck as one change, each list already in its stacking order: every item keeps its id and
// takes the value a tab appending it would write, so later moves find room on both sides
export function writeDeck(doc: Y.Doc, slides: DeckSlide[]) {
  doc.transact(() => {
    let slideOrder = ''
    for (const { id, boxes, ...fields } of slides) {
      slideOrder = orderPast(slideOrder)
      const slide: Item = new Y.Map()
      slidesOf(doc).set(id, slide)
      slide.set('order', slideOrder)
      writeFields(slide, fields, SLIDE_FIELDS)
      writeBoxes(doc, id, boxes)
    }
  })
}

function writeBoxes(doc: Y.Doc, parent: string, boxes: DeckItem[]) {
  let boxOrder = ''
  for (const { id, ...fields } of boxes) {
    boxOrder = orderPast(boxOrder)
    const box: Item = new Y.Map()
    boxesOf(doc).set(id, box)
    box.set('parent', parent)
    box.set('order', boxOrder)
    if (TYPES_WITH_TEXT.has(fields.type as string)) {
      box.set('text', new Y.XmlFragment())
    }

    writeFields(box, fields, BOX_FIELDS)
  }
}

export function addSlide(doc: Y.Doc, fields: Fields = {}, afterId?: string) {
  const id = randomId()
  doc.transact(() => {
    const siblings = slidesInOrder(doc)
    const slide: Item = new Y.Map()
    slidesOf(doc).set(id, slide)
    slide.set('order', orderAfter(siblings, afterId ?? siblings.at(-1)?.id ?? null))
    writeFields(slide, fields, SLIDE_FIELDS)
  })

  return id
}

// New boxes go on top of their slide
export function addBox(doc: Y.Doc, parent: string, fields: Fields) {
  refuseDrawnBlank(parent)
  const id = randomId()
  doc.transact(() => {
    const siblings = boxesInOrder(doc, parent)
    const box: Item = new Y.Map()
    boxesOf(doc).set(id, box)
    box.set('parent', parent)
    box.set('order', orderOnTop(siblings))
    if (TYPES_WITH_TEXT.has(fields.type as string)) {
      box.set('text', new Y.XmlFragment())
    }

    writeFields(box, fields, BOX_FIELDS)
  })

  return id
}

// A slide or box another tab deleted stays deleted: these change nothing then
export function setSlide(doc: Y.Doc, id: string, fields: Fields) {
  const slide = slidesOf(doc).get(id)
  if (slide) {
    doc.transact(() => writeFields(slide, fields, SLIDE_FIELDS))
  }
}

export function setBox(doc: Y.Doc, id: string, fields: Fields) {
  const box = boxesOf(doc).get(id)
  if (box) {
    doc.transact(() => writeFields(box, fields, BOX_FIELDS))
  }
}

export function boxText(doc: Y.Doc, id: string): Y.XmlFragment | undefined {
  return boxesOf(doc).get(id)?.get('text') as Y.XmlFragment | undefined
}

export function moveSlide(doc: Y.Doc, id: string, afterId: string | null) {
  const slide = slidesOf(doc).get(id)
  if (!slide || afterId === id) {
    return
  }

  const others = slidesInOrder(doc).filter((sibling) => sibling.id !== id)
  slide.set('order', orderAfter(others, afterId))
}

export function moveBox(doc: Y.Doc, id: string, afterId: string | null) {
  const box = boxesOf(doc).get(id)
  if (!box || afterId === id) {
    return
  }

  const others = boxesInOrder(doc, box.get('parent') as string).filter(
    (sibling) => sibling.id !== id,
  )
  box.set('order', orderAfter(others, afterId))
}

// A box moved to another slide goes on top there
export function moveBoxToSlide(doc: Y.Doc, id: string, parent: string) {
  refuseDrawnBlank(parent)
  const box = boxesOf(doc).get(id)
  if (!box) {
    return
  }

  doc.transact(() => {
    const siblings = boxesInOrder(doc, parent)
    box.set('parent', parent)
    box.set('order', orderOnTop(siblings))
  })
}

export function deleteBox(doc: Y.Doc, id: string) {
  boxesOf(doc).delete(id)
}

// One change, so no tab ever sees the slide gone and its boxes still there
export function deleteSlide(doc: Y.Doc, id: string) {
  doc.transact(() => {
    for (const { id: boxId } of boxesInOrder(doc, id)) {
      boxesOf(doc).delete(boxId)
    }

    slidesOf(doc).delete(id)
  })
}

export function slideIds(doc: Y.Doc) {
  return slidesInOrder(doc).map(({ id }) => id)
}

export function boxIds(doc: Y.Doc, slideId: string) {
  return boxesInOrder(doc, slideId).map(({ id }) => id)
}

// Reads below fix leftovers of a merge in what they return and never write, so
// the hidden data comes back with a version restore

function plainFields(id: string, item: Item): DeckItem {
  const fields = [...item.entries()].filter(([key]) => !NOT_FIELDS.has(key))

  // A copy, since the old stores change what they get in place, and a change to
  // the stored object would reach this tab alone with no update sent
  return { id, ...structuredClone(Object.fromEntries(fields)) }
}

function boxEntriesBySlide(doc: Y.Doc) {
  const bySlide = new Map<string, [string, Item][]>()
  for (const entry of boxesOf(doc).entries()) {
    const [, box] = entry
    const parent = box.get('parent') as string
    if (!bySlide.has(parent)) {
      bySlide.set(parent, [])
    }

    bySlide.get(parent)!.push(entry)
  }

  return bySlide
}

// A connector end draws free when its target is gone, or is not on this slide
function freeLostEnds(box: DeckItem, onSlide: Set<string>) {
  for (const key of CONNECTOR_ENDS) {
    const end = box[key] as { elementId: string } | null | undefined
    if (end && !onSlide.has(end.elementId)) {
      box[key] = null
    }
  }

  return box
}

// The deck to draw. A box whose slide is gone has no slide to appear under, and
// a deck with no slides draws one blank that is not in the doc
export function readSlides(doc: Y.Doc): DeckSlide[] {
  const bySlide = boxEntriesBySlide(doc)
  const slides = slidesInOrder(doc).map(({ id, item }) => {
    const entries = bySlide.get(id) ?? []
    const onSlide = new Set(entries.map(([boxId]) => boxId))
    const boxes = inOrder(entries).map((box) =>
      freeLostEnds(plainFields(box.id, box.item), onSlide),
    )

    return { ...plainFields(id, item), boxes }
  })

  if (!slides.length) {
    return [{ id: DRAWN_BLANK, boxes: [] }]
  }

  return slides
}

// For a tab that edits. The id is random so two tabs doing this at once each
// keep their slide: a shared id would drop one tab's entry on merge
export function addBlankIfEmpty(doc: Y.Doc) {
  if (!slidesOf(doc).size) {
    addSlide(doc)
  }
}
