// The Y.Doc layout for one deck. Everything that reads or writes the collab
// doc goes through here, so the spelling lives in one place (the server
// registration in suite/slides/content mirrors it)
//
// Layout (one Y.Doc per deck):
//
//   slides   Y.Map   slide id → Y.Map of SLIDE_KEYS
//   elements    Y.Map   element id → Y.Map of ELEMENT_KEYS
//
// Flat, with no nesting: `parent` names an element's slide. `order` is a string
// compared by code unit, ties broken by id, so a move writes one value on the
// moved item and a gap never runs out. `frame` holds position, size and the
// centred form as one value, so two tabs can't mix them. `text` is a Y.XmlFragment
// holding the element's rich text. The doc holds no Y.Array and no Y.Text

import * as Y from 'yjs'

import { randomId } from '@/platform/random-id'

export const ROOT = { slides: 'slides', elements: 'elements' } as const

export const SLIDE_FIELDS = new Set([
  'background',
  'transition',
  'transitionDuration',
  'fadeUnmatchedElements',
  'advanceAfter',
])

export const ELEMENT_FIELDS = new Set([
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
export const ELEMENT_KEYS = ['parent', 'order', 'text', ...ELEMENT_FIELDS]

export const ELEMENT_TYPES = new Set(['text', 'image', 'video', 'shape', 'table'])
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
  elements: DeckItem[]
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
  const value = item.get('order')
  return typeof value === 'string' ? value : ''
}

function slidesOf(doc: Y.Doc): Y.Map<Item> {
  return doc.getMap(ROOT.slides)
}

function elementsOf(doc: Y.Doc): Y.Map<Item> {
  return doc.getMap(ROOT.elements)
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

function elementsInOrder(doc: Y.Doc, slideId: string) {
  return inOrder(
    [...elementsOf(doc).entries()].filter(([, element]) => element.get('parent') === slideId),
  )
}

// The order that puts an item right after afterId. Null means first. An id that
// is gone, as when another tab just deleted it, means last. Items tied with
// afterId share its value, so the item lands after all of them
function orderAfter(siblings: Sibling[], afterId: string | null) {
  const found = siblings.find(({ id }) => id === afterId) ?? siblings.at(-1)
  const after = afterId === null ? undefined : found
  const lo = after ? orderOf(after.item) : ''
  const next = siblings.find(({ item }) => orderOf(item) > lo)

  return orderBetween(lo, next ? orderOf(next.item) : null)
}

function orderOnTop(siblings: Sibling[]) {
  return orderAfter(siblings, siblings.at(-1)?.id ?? null)
}

// An element under the drawn blank would stay hidden for good, on every tab, since
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
    for (const { id, elements, ...fields } of slides) {
      slideOrder = orderPast(slideOrder)
      const slide: Item = new Y.Map()
      slidesOf(doc).set(id, slide)
      slide.set('order', slideOrder)
      writeFields(slide, fields, SLIDE_FIELDS)
      writeElements(doc, id, elements)
    }
  })
}

function writeElements(doc: Y.Doc, parent: string, elements: DeckItem[]) {
  let elementOrder = ''
  for (const { id, ...fields } of elements) {
    elementOrder = orderPast(elementOrder)
    const element: Item = new Y.Map()
    elementsOf(doc).set(id, element)
    element.set('parent', parent)
    element.set('order', elementOrder)
    if (typeof fields.type === 'string' && TYPES_WITH_TEXT.has(fields.type)) {
      element.set('text', new Y.XmlFragment())
    }

    writeFields(element, fields, ELEMENT_FIELDS)
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

// New elements go on top of their slide
export function addElement(doc: Y.Doc, parent: string, fields: Fields) {
  refuseDrawnBlank(parent)
  const id = randomId()
  doc.transact(() => {
    const siblings = elementsInOrder(doc, parent)
    const element: Item = new Y.Map()
    elementsOf(doc).set(id, element)
    element.set('parent', parent)
    element.set('order', orderOnTop(siblings))
    if (typeof fields.type === 'string' && TYPES_WITH_TEXT.has(fields.type)) {
      element.set('text', new Y.XmlFragment())
    }

    writeFields(element, fields, ELEMENT_FIELDS)
  })

  return id
}

// A slide or element another tab deleted stays deleted: these change nothing then
export function setSlide(doc: Y.Doc, id: string, fields: Fields) {
  const slide = slidesOf(doc).get(id)
  if (slide) {
    doc.transact(() => writeFields(slide, fields, SLIDE_FIELDS))
  }
}

export function setElement(doc: Y.Doc, id: string, fields: Fields) {
  const element = elementsOf(doc).get(id)
  if (element) {
    doc.transact(() => writeFields(element, fields, ELEMENT_FIELDS))
  }
}

export function elementText(doc: Y.Doc, id: string): Y.XmlFragment | undefined {
  const text = elementsOf(doc).get(id)?.get('text')
  return text instanceof Y.XmlFragment ? text : undefined
}

export function moveSlide(doc: Y.Doc, id: string, afterId: string | null) {
  const slide = slidesOf(doc).get(id)
  if (!slide || afterId === id) {
    return
  }

  const others = slidesInOrder(doc).filter((sibling) => sibling.id !== id)
  slide.set('order', orderAfter(others, afterId))
}

export function moveElement(doc: Y.Doc, id: string, afterId: string | null) {
  const element = elementsOf(doc).get(id)
  if (!element || afterId === id) {
    return
  }

  const parent = element.get('parent')
  if (typeof parent !== 'string') return
  const others = elementsInOrder(doc, parent).filter((sibling) => sibling.id !== id)
  element.set('order', orderAfter(others, afterId))
}

// An element moved to another slide goes on top there
export function moveElementToSlide(doc: Y.Doc, id: string, parent: string) {
  refuseDrawnBlank(parent)
  const element = elementsOf(doc).get(id)
  if (!element) {
    return
  }

  doc.transact(() => {
    const siblings = elementsInOrder(doc, parent)
    element.set('parent', parent)
    element.set('order', orderOnTop(siblings))
  })
}

export function deleteElement(doc: Y.Doc, id: string) {
  elementsOf(doc).delete(id)
}

// One change, so no tab ever sees the slide gone and its elements still there
export function deleteSlide(doc: Y.Doc, id: string) {
  doc.transact(() => {
    for (const { id: elementId } of elementsInOrder(doc, id)) {
      elementsOf(doc).delete(elementId)
    }

    slidesOf(doc).delete(id)
  })
}

export function slideIds(doc: Y.Doc) {
  return slidesInOrder(doc).map(({ id }) => id)
}

export function elementIds(doc: Y.Doc, slideId: string) {
  return elementsInOrder(doc, slideId).map(({ id }) => id)
}

// Reads below fix leftovers of a merge in what they return and never write, so
// the hidden data comes back with a version restore

function plainFields(id: string, item: Item): DeckItem {
  const fields = [...item.entries()].filter(([key]) => !NOT_FIELDS.has(key))

  // A copy, since the old stores change what they get in place, and a change to
  // the stored object would reach this tab alone with no update sent
  return { id, ...structuredClone(Object.fromEntries(fields)) }
}

function elementEntriesBySlide(doc: Y.Doc) {
  const bySlide = new Map<string, [string, Item][]>()
  for (const entry of elementsOf(doc).entries()) {
    const [, element] = entry
    const parent = element.get('parent')
    if (typeof parent !== 'string') continue
    if (!bySlide.has(parent)) {
      bySlide.set(parent, [])
    }

    bySlide.get(parent)!.push(entry)
  }

  return bySlide
}

// A connector end draws free when its target is gone, or is not on this slide
function freeLostEnds(element: DeckItem, onSlide: Set<string>) {
  for (const key of CONNECTOR_ENDS) {
    const end = element[key]
    if (
      end &&
      (typeof end !== 'object' ||
        !('elementId' in end) ||
        typeof end.elementId !== 'string' ||
        !onSlide.has(end.elementId))
    ) {
      element[key] = null
    }
  }

  return element
}

// The deck to draw. An element whose slide is gone has no slide to appear under, and
// a deck with no slides draws one blank that is not in the doc
export function readSlides(doc: Y.Doc): DeckSlide[] {
  const bySlide = elementEntriesBySlide(doc)
  const slides = slidesInOrder(doc).map(({ id, item }) => {
    const entries = bySlide.get(id) ?? []
    const onSlide = new Set(entries.map(([elementId]) => elementId))
    const elements = inOrder(entries).map((element) =>
      freeLostEnds(plainFields(element.id, element.item), onSlide),
    )

    return { ...plainFields(id, item), elements }
  })

  if (!slides.length) {
    return [{ id: DRAWN_BLANK, elements: [] }]
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
