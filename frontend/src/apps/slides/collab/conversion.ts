// The server's converter (converter-entry.ts): one old deck, as suite/slides/content/conversion.py reads
// its rows with the duplicate ids already repaired, into one Yjs deck. It rewrites the old forms the rows
// still hold and refuses anything else deck.ts has no place for. The rows stay the deck until the server
// installs the answer
//
// A refusal names the rule only, never a key or a value: reasons reach System Managers and server logs,
// and a key or value can be a person's data

import { generateJSON, getSchema } from '@tiptap/core'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'
import { normalizeColor } from '@/apps/slides/utils/color'
import { migrateShadow } from '@/apps/slides/utils/oldShadow'

import {
  BOX_FIELDS,
  BOX_TYPES,
  boxText,
  SLIDE_FIELDS,
  TYPES_WITH_TEXT,
  writeDeck,
  type DeckItem,
  type DeckSlide,
} from './deck'
import { slidesFault } from './fault'

export type RefusalDetail = 'box_type' | 'elements' | 'fault' | 'html' | 'setting'

type Dropped = { kind: 'default-style' } | { kind: 'video-content' }

export interface OldSlide {
  id: string
  elements: OldBox[]
  [field: string]: unknown
}

export interface OldBox {
  id: string
  [key: string]: unknown
}

export interface LegacyDeck {
  slides: OldSlide[]
  // A row's elements didn't parse, which conversion.py can only say here
  isUnreadable?: boolean
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

function isEmpty(value: unknown) {
  return value === null || value === undefined || value === ''
}

function layerOf(box: OldBox) {
  return Number(box.zIndex) || 1
}

// As normalizeZIndices: no zIndex or a zero counts as 1, and ties keep their place in the array
function stacked(boxes: OldBox[]) {
  return [...boxes].sort((one, other) => layerOf(one) - layerOf(other))
}

function frameOf({ left, top, width, height, transform, transformOrigin, type }: OldBox) {
  const placed = { left, top, width, height, transform, transformOrigin }
  // A centred text box is copied as it is. No transform is the form transformElements gives an
  // uncentred one, which only text boxes draw from
  if (type === 'text' && transform === undefined) {
    placed.transform = 'none'
    placed.transformOrigin = 'top left'
  }

  return Object.fromEntries(Object.entries(placed).filter(([, value]) => value !== undefined))
}

function connectorFields(connector: unknown) {
  if (isEmpty(connector)) {
    return {}
  }

  const { start, end, route } = connector as Record<string, unknown>
  if (Object.keys(connector as object).some((key) => !CONNECTOR_KEYS.has(key))) {
    throw new Refused('setting')
  }

  return { connectorStart: start, connectorEnd: end, route }
}

function lineHeightFields(type: unknown, metadata: unknown) {
  if (isEmpty(metadata)) {
    return {}
  }

  const { lineHeight, ...rest } = metadata as Record<string, unknown>
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

// The old forms of a box's own settings, rewritten
function rewritten(old: OldBox) {
  const box = { ...old }
  for (const key of COLOUR_KEYS) {
    if (box[key]) {
      box[key] = normalizeColor(box[key])
    }
  }

  if (box.type === 'shape' && box.shapeType === 'circle') {
    box.shapeType = 'oval'
  }

  migrateShadow(box)
  return box
}

function noteDropped({ type, content, defaultStyle }: OldBox, dropped: Set<Dropped['kind']>) {
  if (defaultStyle !== undefined) {
    dropped.add('default-style')
  }

  if (!TYPES_WITH_TEXT.has(type as string) && !isEmpty(content)) {
    if (type !== 'video') {
      throw new Refused('setting')
    }

    dropped.add('video-content')
  }
}

// A box's fields in the deck's form, with what it dropped
function boxFields(old: OldBox, dropped: Set<Dropped['kind']>): DeckItem {
  const box = rewritten(old)
  const { id, type, connector, editorMetadata } = box
  const rest = Object.fromEntries(Object.entries(box).filter(([key]) => !REPLACED_KEYS.has(key)))
  if (!BOX_TYPES.has(type as string)) {
    throw new Refused('box_type')
  }

  if (Object.keys(rest).some((key) => !BOX_FIELDS.has(key))) {
    throw new Refused('setting')
  }

  noteDropped(box, dropped)
  return withoutUndefined({
    id,
    type,
    frame: frameOf(old),
    ...rest,
    ...connectorFields(connector),
    ...lineHeightFields(type, editorMetadata),
  }) as DeckItem
}

function slideFields(old: OldSlide) {
  const { id: _id, elements: _elements, ...fields } = old
  if (Object.keys(fields).some((key) => !SLIDE_FIELDS.has(key))) {
    throw new Refused('setting')
  }

  return withoutUndefined({ ...fields, background: normalizeColor(fields.background) })
}

interface Held {
  name: string
  entries: Map<string, string>
}

// Tags the editor reads as its own marks, by the tag it draws them with
const DRAWN_AS: Record<string, string> = { b: 'strong', i: 'em', del: 's', strike: 's' }
const FORMATTING_TAGS = new Set([
  'a',
  'b',
  'code',
  'del',
  'em',
  'i',
  's',
  'span',
  'strike',
  'strong',
  'u',
])
const FOLDED_WHITESPACE = /[ \t\n\r\f]/
const HARD_BREAK = '\n'

// The value the browser reads, or the raw text when jsdom can't read it, so a property jsdom doesn't
// know still counts
function styleEntries(element: Element) {
  const scratch = element.ownerDocument.createElement('div').style
  const entries: [string, string][] = []
  for (const piece of (element.getAttribute('style') ?? '').split(';')) {
    const colon = piece.indexOf(':')
    if (colon > 0) {
      const name = piece.slice(0, colon).trim().toLowerCase()
      scratch.cssText = piece
      const read = scratch.getPropertyValue(name) || piece.slice(colon + 1).trim()
      entries.push([name, read.replace(/['"]/g, '')])
    }
  }

  return entries
}

function drawsTheSame(tag: string, [name, value]: [string, string]) {
  // The old editor wrote an item's `opacity` from a 0 to 100 mark, and CSS clamps all but 0 to opaque
  return tag === 'li' && name === 'opacity' && Number(value) >= 1
}

function drawnEntry([name, value]: [string, string]): [string, string] {
  if (name === 'font-style' && value === 'italic') {
    return ['em', '']
  }

  return [name, value]
}

function entriesOf(element: Element, tag: string) {
  const entries = styleEntries(element)
    .filter((entry) => !drawsTheSame(tag, entry))
    .map(drawnEntry)
  for (const { name, value } of element.attributes) {
    if (name === 'class') {
      entries.push(
        ...[...element.classList].map((token): [string, string] => [`class ${token}`, '']),
      )
    } else if (name !== 'style') {
      entries.push([`${tag}@${name}`, value])
    }
  }

  return entries
}

interface Holdings {
  characters: Held[]
  elements: Held[]
}

function holdText(text: string, formats: Map<string, string>, held: Holdings) {
  for (const char of text) {
    if (!FOLDED_WHITESPACE.test(char)) {
      held.characters.push({ name: char, entries: formats })
    }
  }
}

function holdElement(element: Element, formats: Map<string, string>, held: Holdings) {
  const tag = element.localName
  if (tag === 'br') {
    held.characters.push({ name: HARD_BREAK, entries: formats })
    return
  }

  if (!FORMATTING_TAGS.has(tag)) {
    held.elements.push({ name: tag, entries: new Map(entriesOf(element, tag)) })
    holdChildren(element, formats, held)
    return
  }

  const drawn = DRAWN_AS[tag] ?? tag
  const inner = new Map([...formats, ...entriesOf(element, drawn)])
  if (tag !== 'span') {
    inner.set(drawn, '')
  }

  holdChildren(element, inner, held)
}

function holdChildren(parent: ParentNode, formats: Map<string, string>, held: Holdings) {
  for (const node of parent.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      holdText(node.textContent ?? '', formats, held)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      holdElement(node as Element, formats, held)
    }
  }
}

// What HTML holds: its text and hard breaks with the formatting on each, and its other elements
function holdingsOf(root: ParentNode) {
  const held: Holdings = { characters: [], elements: [] }
  holdChildren(root, new Map(), held)
  return held
}

function holds(held: Held, wanted: Held) {
  return (
    held.name === wanted.name &&
    [...wanted.entries].every(([name, value]) => held.entries.get(name) === value)
  )
}

/** Whether `drawn` keeps all of `source`: every character with its formatting, and every element in order. */
export function keepsHtml(source: ParentNode, drawn: ParentNode) {
  const [wanted, result] = [holdingsOf(source), holdingsOf(drawn)]
  const hasSameText =
    wanted.characters.length === result.characters.length &&
    wanted.characters.every((character, at) => holds(result.characters[at], character))
  let at = 0
  return (
    hasSameText &&
    wanted.elements.every((element) => {
      while (at < result.elements.length && !holds(result.elements[at], element)) {
        at += 1
      }

      at += 1
      return at <= result.elements.length
    })
  )
}

function parsedContent(content: unknown): { node: PMNode; source: ParentNode | null } {
  if (isEmpty(content)) {
    return { node: schema.topNodeType.createAndFill() as PMNode, source: null }
  }

  // An editor can save a box's body as the document itself, which TextElement reads as well
  if (typeof content === 'object') {
    return { node: schema.nodeFromJSON(content), source: null }
  }

  const html = String(content)
  const { body } = new DOMParser().parseFromString(html, 'text/html')
  return { node: schema.nodeFromJSON(generateJSON(html, extensions)), source: body }
}

function fillText(doc: Y.Doc, id: string, content: unknown) {
  const fragment = boxText(doc, id) as Y.XmlFragment
  let parsed: ReturnType<typeof parsedContent>
  try {
    parsed = parsedContent(content)
    prosemirrorToYXmlFragment(parsed.node, fragment)
  } catch {
    // TipTap throws on a document its schema has no place for
    throw new Refused('html')
  }

  const read = yXmlFragmentToProseMirrorRootNode(fragment, schema)
  const drawn = DOMSerializer.fromSchema(schema).serializeFragment(read.content)
  if (!read.eq(parsed.node) || (parsed.source && !keepsHtml(parsed.source, drawn))) {
    throw new Refused('html')
  }
}

function build(legacy: LegacyDeck) {
  const dropped = new Set<Dropped['kind']>()
  const doc = new Y.Doc()
  const contents: [string, unknown][] = []
  const slides: DeckSlide[] = legacy.slides.map((old) => ({
    id: old.id,
    ...slideFields(old),
    boxes: stacked(old.elements).map((box) => {
      const fields = boxFields(box, dropped)
      if (TYPES_WITH_TEXT.has(fields.type as string)) {
        contents.push([fields.id, box.content])
      }

      return fields
    }),
  }))
  writeDeck(doc, slides)
  for (const [id, content] of contents) {
    fillText(doc, id, content)
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
