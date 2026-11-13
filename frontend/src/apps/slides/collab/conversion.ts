// The server's converter (converter-entry.ts): one old deck, as suite/slides/content/conversion.py reads
// its rows with the duplicate ids already repaired, into one Yjs deck. It rewrites the old forms the rows
// still hold and refuses anything else deck.ts has no place for. The rows stay the deck until the server
// installs the answer
//
// A refusal names the rule only, never a key or a value: reasons reach System Managers and server logs,
// and a key or value can be a person's data

import { getSchema, type JSONContent } from '@tiptap/core'
import { DOMSerializer, DOMParser as PMDOMParser, type Node as PMNode } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import { extensions, oldBodyHTML } from '@/apps/slides/stores/tiptapSetup'
import { normalizeColor } from '@/apps/slides/utils/color'
import { migrateShadow } from '@/apps/slides/utils/oldShadow'

import {
  ELEMENT_FIELDS,
  ELEMENT_TYPES,
  elementText,
  SLIDE_FIELDS,
  TYPES_WITH_TEXT,
  writeDeck,
  type DeckItem,
  type DeckSlide,
} from './deck'
import { slidesFault } from './fault'
import {
  carryItemStyles,
  compareBodies,
  holdItemLooks,
  isBesideBareText,
  itemsToHold,
  stateLineHeights,
  type DrawRules,
} from './oldBody'

export type RefusalDetail =
  'element_type' | 'elements' | 'fault' | 'html' | 'magic_move' | 'setting'

type DroppedKind = 'default-style' | 'horizontal-rule' | 'list-marker-style' | 'video-content'
interface Dropped {
  kind: DroppedKind
}

export interface OldSlide {
  id: string
  elements: OldElement[]
  [field: string]: unknown
}

export interface OldElement {
  id: string
  [key: string]: unknown
}

export interface LegacyDeck {
  slides: OldSlide[]
  // A row's elements didn't parse, which conversion.py can only say here
  isUnreadable?: boolean
  // A table would need a new id, which is all Magic Move pairs it on
  isTableKeyLost?: boolean
}

export type ConverterAnswer =
  | {
      kind: 'converted'
      state: Uint8Array
      // convert.py takes "yjs" or "html" for where the state came from; a deck's rows are neither, and
      // nothing reads it, so it answers "yjs"
      from: 'yjs'
      dropped: Dropped[]
      // Writer's comment anchors and threads; a deck's comments are Drive's already
      anchors: Record<string, never>
      threads: never[]
      // Rows stay the deck's readable copy, so the server asks for no HTML
      html: ''
    }
  | { kind: 'failed'; reason: 'too_large' }
  | { kind: 'failed'; reason: 'check'; detail: RefusalDetail }

class Refused extends Error {
  constructor(readonly detail: RefusalDetail) {
    super(detail)
  }
}

const schema = getSchema(extensions)
const COLOUR_KEYS = ['fillColor', 'strokeColor', 'borderColor', 'shadowColor']
const CONNECTOR_KEYS = new Set(['start', 'end', 'route'])
const DEFAULT_LINE_HEIGHT = '1.5'

function isEmpty(value: unknown) {
  return value === null || value === undefined || value === ''
}

function layerOf(element: OldElement) {
  return Number(element.zIndex) || 1
}

// As normalizeZIndices: no zIndex or a zero counts as 1, and ties keep their place in the array
function stacked(elements: OldElement[]) {
  return [...elements].sort((one, other) => layerOf(one) - layerOf(other))
}

function frameOf({ left, top, width, height, transform, transformOrigin, type }: OldElement) {
  const placed = { left, top, width, height, transform, transformOrigin }
  // A centred text element is copied as it is. No transform is the form transformElements gives an
  // uncentred one, which only text elements draw from
  if (type === 'text' && transform === undefined) {
    placed.transform = 'none'
    placed.transformOrigin = 'top left'
  }

  return Object.fromEntries(Object.entries(placed).filter(([, value]) => value !== undefined))
}

function isLegacySettings(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function connectorFields(connector: unknown) {
  if (isEmpty(connector)) {
    return {}
  }

  if (!isLegacySettings(connector)) throw new Refused('setting')
  const { start, end, route } = connector
  if (Object.keys(connector).some((key) => !CONNECTOR_KEYS.has(key))) {
    throw new Refused('setting')
  }

  return { connectorStart: start, connectorEnd: end, route }
}

interface LineHeightFields {
  lineHeight?: unknown
}

function lineHeightFields(type: unknown, metadata: unknown): LineHeightFields {
  if (isEmpty(metadata)) {
    return {}
  }

  if (!isLegacySettings(metadata)) throw new Refused('setting')
  const { lineHeight, ...rest } = metadata
  if (type !== 'text' || Object.keys(rest).length) {
    throw new Refused('setting')
  }

  if (!lineHeight) {
    return {}
  }

  return { lineHeight }
}

// Held elsewhere in the deck's form, or gone with the old editor's shadow settings
const REPLACED_KEYS = new Set([
  'id',
  'type',
  'zIndex',
  'content',
  'defaultStyle',
  'editorMetadata',
  'connector',
  'left',
  'top',
  'width',
  'height',
  'transform',
  'transformOrigin',
  'shadowSpread',
  'shadowOffsetX',
  'shadowOffsetY',
])

function withoutUndefined(fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

// The old forms of an element's own settings, rewritten
function rewritten(old: OldElement) {
  const element = { ...old }
  for (const key of COLOUR_KEYS) {
    if (element[key]) {
      element[key] = normalizeColor(element[key])
    }
  }

  if (element.type === 'shape' && element.shapeType === 'circle') {
    element.shapeType = 'oval'
  }

  // an old video saved its poster as the object that captured it
  if (isLegacySettings(element.poster)) {
    if (typeof element.poster.posterURL !== 'string') {
      throw new Refused('setting')
    }

    element.poster = element.poster.posterURL
  }

  migrateShadow(element)
  return element
}

function noteDropped({ type, content, defaultStyle }: OldElement, dropped: Set<DroppedKind>) {
  if (defaultStyle !== undefined) {
    dropped.add('default-style')
  }

  if (!(typeof type === 'string' && TYPES_WITH_TEXT.has(type)) && !isEmpty(content)) {
    if (type !== 'video') {
      throw new Refused('setting')
    }

    dropped.add('video-content')
  }
}

// An element's fields in the deck's form, with what it dropped
function elementFields(old: OldElement, dropped: Set<DroppedKind>): DeckItem {
  const element = rewritten(old)
  const { id, type, connector, editorMetadata } = element
  const rest = Object.fromEntries(
    Object.entries(element).filter(([key]) => !REPLACED_KEYS.has(key)),
  )
  if (!(typeof type === 'string' && ELEMENT_TYPES.has(type))) {
    throw new Refused('element_type')
  }

  if (Object.keys(rest).some((key) => !ELEMENT_FIELDS.has(key))) {
    throw new Refused('setting')
  }

  noteDropped(element, dropped)
  return {
    ...withoutUndefined({
      id,
      type,
      frame: frameOf(old),
      ...rest,
      ...connectorFields(connector),
      ...lineHeightFields(type, editorMetadata),
    }),
    id,
  }
}

function slideFields(old: OldSlide) {
  const { id: _id, elements: _elements, ...fields } = old
  if (Object.keys(fields).some((key) => !SLIDE_FIELDS.has(key))) {
    throw new Refused('setting')
  }

  return withoutUndefined({ ...fields, background: normalizeColor(fields.background) })
}

function withoutEmptyAttrs(mark: { type: string; attrs?: Record<string, unknown> }) {
  const attrs = Object.entries(mark.attrs ?? {}).map(([name, value]) => {
    if (value === '') {
      return [name, null]
    }

    return [name, value]
  })

  return { ...mark, attrs: Object.fromEntries(attrs) }
}

// The editor's colour parser answers an empty string for a span with no colour, which no old HTML holds
function withoutEmptyStyles(json: JSONContent): JSONContent {
  const { content, marks, ...rest } = json
  const cleaned: JSONContent = { ...rest }
  if (content) {
    cleaned.content = content.map(withoutEmptyStyles)
  }

  if (marks) {
    cleaned.marks = marks.map(withoutEmptyAttrs)
  }

  return cleaned
}

function rulesOf(element: OldElement): DrawRules {
  if (element.type === 'table') {
    return { lineHeight: DEFAULT_LINE_HEIGHT, isWhitespaceKept: false }
  }

  const { lineHeight } = lineHeightFields(element.type, element.editorMetadata)
  const drawn = lineHeight || element.lineHeight || DEFAULT_LINE_HEIGHT
  return { lineHeight: String(drawn), isWhitespaceKept: true }
}

// An editor can save an element's body as the document itself; the old view turned it into HTML to draw it
function oldHtml(content: unknown) {
  if (typeof content === 'object') {
    return oldBodyHTML(content)
  }

  return String(content)
}

function parsedNode(html: HTMLElement, rules: DrawRules) {
  const whitespace = rules.isWhitespaceKept && 'full'
  const parsed = PMDOMParser.fromSchema(schema).parse(html, { preserveWhitespace: whitespace })

  return schema.nodeFromJSON(withoutEmptyStyles(parsed.toJSON()))
}

function parsedContent(element: OldElement, rules: DrawRules, dropped: Set<DroppedKind>) {
  // The old view sets this as a `div`'s HTML; alone, the parser would drop leading whitespace it draws
  const html = oldHtml(element.content)
  const { body } = new DOMParser().parseFromString(`<body>${html}`, 'text/html')
  // No screen draws one: the old view's sanitizer removes it and the schema has no place for it
  for (const rule of body.querySelectorAll('hr')) {
    if (isBesideBareText(rule)) {
      throw new Refused('html')
    }

    rule.remove()
    dropped.add('horizontal-rule')
  }

  // Rules were all it held, so the old view draws an empty element
  if (!body.hasChildNodes()) {
    return null
  }

  const carried = body.cloneNode(true)
  if (!(carried instanceof HTMLElement))
    throw new Error('Carried body clone must be an HTML element')
  stateLineHeights(carried, rules)
  carryItemStyles(carried, rules)
  const held = new Set<number>()
  for (;;) {
    const node = parsedNode(carried, rules)
    const saved = savedBody(node, body.ownerDocument)
    const added = holdItemLooks(carried, rules, itemsToHold(body, saved, rules, held))
    if (!added.size) {
      return { node, source: body, held }
    }

    for (const at of added) {
      held.add(at)
    }
  }
}

function fillEmptyText(fragment: Y.XmlFragment) {
  const empty = schema.topNodeType.createAndFill()
  if (!empty) throw new Error('Slide text schema has no empty document')
  prosemirrorToYXmlFragment(empty, fragment)
}

function filled(
  element: OldElement,
  fragment: Y.XmlFragment,
  rules: DrawRules,
  dropped: Set<DroppedKind>,
) {
  try {
    const parsed = parsedContent(element, rules, dropped)
    if (parsed) {
      prosemirrorToYXmlFragment(parsed.node, fragment)
    }

    return parsed
  } catch {
    // TipTap throws on a document its schema has no place for, and `holdItemLooks` on what no run holds
    throw new Refused('html')
  }
}

// The saved body in the HTML the slide components are given, by the same renderers as `drawnSlides`
function savedBody(read: PMNode, document: Document) {
  const saved = document.createElement('body')
  saved.append(DOMSerializer.fromSchema(schema).serializeFragment(read.content, { document }))
  return saved
}

function fillText(doc: Y.Doc, element: OldElement, id: string, dropped: Set<DroppedKind>) {
  const fragment = elementText(doc, id)
  if (!fragment) throw new Error('Slide text element has no fragment')
  if (isEmpty(element.content)) {
    fillEmptyText(fragment)
    return
  }

  const rules = rulesOf(element)
  const parsed = filled(element, fragment, rules, dropped)
  if (!parsed) {
    fillEmptyText(fragment)
    return
  }

  const { node, source, held } = parsed
  const read = yXmlFragmentToProseMirrorRootNode(fragment, schema)
  const { isSameBody, isSameMarkers } = compareBodies(
    source,
    savedBody(read, source.ownerDocument),
    rules,
    held,
  )
  if (!read.eq(node) || !isSameBody) {
    throw new Refused('html')
  }

  if (!isSameMarkers) {
    dropped.add('list-marker-style')
  }
}

function build(legacy: LegacyDeck) {
  const dropped = new Set<DroppedKind>()
  const doc = new Y.Doc()
  const contents: [string, OldElement][] = []
  const slides: DeckSlide[] = legacy.slides.map((old) => ({
    id: old.id,
    ...slideFields(old),
    elements: stacked(old.elements).map((element) => {
      const fields = elementFields(element, dropped)
      if (typeof fields.type === 'string' && TYPES_WITH_TEXT.has(fields.type)) {
        contents.push([fields.id, element])
      }

      return fields
    }),
  }))
  writeDeck(doc, slides)
  for (const [id, element] of contents) {
    fillText(doc, element, id, dropped)
  }

  if (slidesFault(doc)) {
    throw new Refused('fault')
  }

  return { doc, dropped: [...dropped].map((kind): Dropped => ({ kind })) }
}

/** Convert an old deck, or say which rule it breaks. Anything else that throws is a converter bug, which the server counts as a crash. */
export function convertLegacy(legacy: LegacyDeck, maxState: number): ConverterAnswer {
  if (legacy.isUnreadable) {
    return { kind: 'failed', reason: 'check', detail: 'elements' }
  }

  if (legacy.isTableKeyLost) {
    return { kind: 'failed', reason: 'check', detail: 'magic_move' }
  }

  try {
    const { doc, dropped } = build(legacy)
    const state = Y.encodeStateAsUpdate(doc)
    if (state.length > maxState) {
      return { kind: 'failed', reason: 'too_large' }
    }

    return { kind: 'converted', state, from: 'yjs', dropped, anchors: {}, threads: [], html: '' }
  } catch (refused) {
    if (refused instanceof Refused) {
      return { kind: 'failed', reason: 'check', detail: refused.detail }
    }

    throw refused
  }
}
