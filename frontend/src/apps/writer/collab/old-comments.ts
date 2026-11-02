import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import {
  absolutePositionToRelativePosition,
  initProseMirrorDoc,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap'
import {
  applyUpdate,
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromTypeIndex,
  decodeRelativePosition,
  Doc,
  XmlElement,
  XmlFragment,
  XmlText,
  type RelativePosition,
  type XmlHook,
} from 'yjs'

import { encodeAnchor } from '@/apps/writer/collab/anchors'
import { BODY_FIELD } from '@/apps/writer/collab/field'
import { isPlainObject, OVERLAP_SUFFIX } from '@/apps/writer/collab/inventory'
import { MEDIA } from '@/apps/writer/collab/legacy-read'
import { readOldThreads } from '@/apps/writer/collab/old-threads'
import { quoteBetween } from '@/apps/writer/collab/places'

// The old comment mark, which excludes itself, so the binding keeps it under its own name
const COMMENT_KEY = 'comment'

// Drive's later comment mark, which could overlap itself (`excludes: ''`), so the binding keeps
// each under a hashed name; and the list its threads were kept in
const ANNOTATION_KEY = 'annotation'
const ANNOTATIONS_ROOT = 'docAnnotations'

// Drive's later comment mark in HTML, holding an annotation id
export const ANNOTATION_TAG = 'span[data-annotation-id]'

interface Run {
  type: XmlElement | XmlFragment | XmlText
  from: number
  to: number
  atom?: XmlElement
}

interface PlacedRun {
  from: RelativePosition
  to: RelativePosition
  fromPlace: number
  toPlace: number
}

// The binding keeps inline nodes as elements, so a text holds only strings; conversion reads only
// the body the binding wrote
interface Insert {
  insert: string
  attributes?: Record<string, unknown>
}

function threadId(attrs: unknown): string | undefined {
  if (!isPlainObject(attrs)) {
    return undefined
  }

  const id = attrs.commentId
  if (typeof id === 'string' && id.trim()) {
    return id
  }

  return undefined
}

// Drive's 2023 comment mark, holding its whole thread as JSON text
function threadText(attrs: unknown): string | undefined {
  if (!isPlainObject(attrs) || Object.keys(attrs).length !== 1) {
    return undefined
  }

  const { comment } = attrs
  return typeof comment === 'string' ? comment : undefined
}

function markName(key: string) {
  return key.replace(OVERLAP_SUFFIX, '')
}

// An annotation, or a comment mark with no thread id
function isUnreadableMark([key, attrs]: [string, unknown]) {
  const name = markName(key)
  return name === ANNOTATION_KEY || (name === COMMENT_KEY && threadId(attrs) === undefined)
}

function addMarkEntries(
  type: XmlElement | XmlFragment | XmlText | XmlHook,
  entries: [string, unknown][],
) {
  if (type instanceof XmlText) {
    for (const op of type.toDelta() as Insert[]) {
      entries.push(...Object.entries(op.attributes ?? {}))
    }

    return
  }

  if (type instanceof XmlElement) {
    entries.push(...Object.entries(type.getAttributes()))
  }

  if (!(type instanceof XmlElement || type instanceof XmlFragment)) {
    return
  }

  for (const child of type.toArray()) {
    addMarkEntries(child, entries)
  }
}

/** The old comment marks and annotations in `old` that no thread can be made from yet */
export function unreadableThreads(old: Doc) {
  const entries: [string, unknown][] = []
  addMarkEntries(old.getXmlFragment(BODY_FIELD), entries)
  const found = entries.filter(isUnreadableMark).map(([key]) => key)
  if (old.share.has(ANNOTATIONS_ROOT) && old.getArray(ANNOTATIONS_ROOT).length) {
    found.push(ANNOTATIONS_ROOT)
  }

  return found
}

type IdOf = (attrs: unknown) => string | undefined

function textRuns(text: XmlText, idOf: IdOf) {
  const runs: [string, Run][] = []
  let from = 0
  for (const { insert, attributes } of text.toDelta() as Insert[]) {
    const to = from + insert.length
    const id = idOf(attributes?.[COMMENT_KEY])
    if (id !== undefined) {
      runs.push([id, { type: text, from, to }])
    }

    from = to
  }

  return runs
}

// An inline atom such as a mention keeps its comment in its attributes and its place by index
function atomRuns(
  parent: XmlElement | XmlFragment,
  child: unknown,
  index: number,
  schema: Schema,
  idOf: IdOf,
): [string, Run][] {
  if (!(child instanceof XmlElement && schema.nodes[child.nodeName]?.isInline)) {
    return []
  }

  const id = idOf(child.getAttribute(COMMENT_KEY))
  if (id === undefined) {
    return []
  }

  return [[id, { type: parent, from: index, to: index + 1, atom: child }]]
}

function addCommentRuns(
  type: XmlElement | XmlFragment | XmlText | XmlHook,
  schema: Schema,
  runs: [string, Run][],
  idOf: IdOf,
) {
  if (type instanceof XmlText) {
    runs.push(...textRuns(type, idOf))
    return
  }

  if (!(type instanceof XmlElement || type instanceof XmlFragment)) {
    return
  }

  for (const [index, child] of type.toArray().entries()) {
    runs.push(...atomRuns(type, child, index, schema, idOf))
    addCommentRuns(child, schema, runs, idOf)
  }
}

/** The ids of the old comment marks in `body` that carry a thread id */
export function markedIds(body: XmlFragment, schema: Schema) {
  return new Set(commentRuns(body, schema).map(([id]) => id))
}

function commentRuns(body: XmlFragment, schema: Schema, idOf: IdOf = threadId) {
  const runs: [string, Run][] = []
  addCommentRuns(body, schema, runs, idOf)
  return runs
}

/**
 * Puts the key of its thread on each of Drive's 2023 comment marks in `body`, so it reads as a
 * comment; the threads, or null when one can't be read
 */
export function markOldThreads(body: XmlFragment, schema: Schema) {
  const runs = commentRuns(body, schema, threadText)
  const read = readOldThreads(runs.map(([text]) => text))
  if (!read) {
    return null
  }

  for (const [text, { type, from, to, atom }] of runs) {
    const mark = { commentId: read.keyOf.get(text) }
    if (atom) {
      atom.setAttribute(COMMENT_KEY, mark as never)
    } else if (type instanceof XmlText) {
      type.format(from, to - from, { [COMMENT_KEY]: mark })
    }
  }

  return read
}

// Where the editor shows `position`, or null when it can't
function placeOf(
  body: XmlFragment,
  built: ReturnType<typeof initProseMirrorDoc>,
  position: RelativePosition,
) {
  const { mapping, meta } = built
  return relativePositionToAbsolutePosition(body.doc!, body, position, mapping, meta.hidden)
}

function placedRun(
  body: XmlFragment,
  built: ReturnType<typeof initProseMirrorDoc>,
  run: Run,
): PlacedRun | null {
  const from = createRelativePositionFromTypeIndex(run.type, run.from, 0)
  const to = createRelativePositionFromTypeIndex(run.type, run.to, -1)
  const fromPlace = placeOf(body, built, from)
  const toPlace = placeOf(body, built, to)
  if (fromPlace === null || toPlace === null || fromPlace >= toPlace) {
    return null
  }

  return { from, to, fromPlace, toPlace }
}

// Runs in one textblock, or with only block boundaries between them, are one stretch; any leaf
// between them, a hard break or an image as well, counts as content
function joins(doc: PMNode, before: PlacedRun, after: PlacedRun) {
  const end = before.toPlace
  const start = after.fromPlace
  return (
    doc.resolve(end).parent === doc.resolve(start).parent ||
    doc.textBetween(end, start, '', '\ufffc') === ''
  )
}

// Old Writer copied a comment's mark with its words, so one id can sit in places far apart
function firstStretch(doc: PMNode, runs: PlacedRun[]) {
  const end = runs.findIndex((run, index) => index > 0 && !joins(doc, runs[index - 1], run))
  if (end < 0) {
    return runs
  }

  return runs.slice(0, end)
}

// Each stretch of a comment's runs, in order, with its words
function stretches(doc: PMNode, runs: PlacedRun[]) {
  const found: { start: PlacedRun; end: PlacedRun; quote: string }[] = []
  let left = runs
  while (left.length) {
    const stretch = firstStretch(doc, left)
    const start = stretch[0]
    const end = stretch.at(-1)!
    found.push({ start, end, quote: quoteBetween(doc, start.fromPlace, end.toPlace) })
    left = left.slice(stretch.length)
  }

  return found
}

/**
 * Each old comment's anchor in `body`, from the first character or atom its mark covers to the
 * last of that stretch, and the words of its copies elsewhere; a comment the editor can't place
 * gets none
 */
export function oldCommentAnchors(body: XmlFragment, schema: Schema) {
  const built = initProseMirrorDoc(body, schema)
  const runs = new Map<string, (PlacedRun | null)[]>()
  for (const [id, run] of commentRuns(body, schema)) {
    const known = runs.get(id) ?? []
    known.push(placedRun(body, built, run))
    runs.set(id, known)
  }

  const anchors: Record<string, string> = {}
  const copies: { id: string; text: string }[] = []
  for (const [id, placed] of runs) {
    if (!placed.every((run): run is PlacedRun => run !== null)) {
      continue
    }

    const [first, ...rest] = stretches(built.doc, placed)
    anchors[id] = encodeAnchor(first.start.from, first.end.to, first.quote)
    copies.push(...rest.map(({ quote }) => ({ id, text: quote })))
  }

  return { anchors, copies }
}

/** Takes the old comment marks that carry a thread id off `body`; the ids it took them from */
export function dropCommentMarks(body: XmlFragment, schema: Schema) {
  const runs = commentRuns(body, schema)
  for (const [, { type, from, to, atom }] of runs) {
    if (atom) {
      atom.removeAttribute(COMMENT_KEY)
    } else if (type instanceof XmlText) {
      type.format(from, to - from, { [COMMENT_KEY]: null })
    }
  }

  return runs.map(([id]) => id)
}

/** An old comment Writer kept beside the body, under its own id */
export type ListedComment = Record<string, unknown> & { id: string }

/** The old comments Writer kept beside the body, or null when they can't be read or one sits under another key */
export function listedComments(stored: string | null): ListedComment[] | null {
  if (!stored) {
    return []
  }

  const doc = new Doc()
  try {
    applyUpdate(
      doc,
      Uint8Array.from(atob(stored), (char) => char.charCodeAt(0)),
    )
  } catch {
    return null
  }

  const comments = doc.getMap('comments')
  const listed: ListedComment[] = []
  for (const key of comments.keys()) {
    const entry = comments.get(key)
    if (!isPlainObject(entry) || entry.id !== key) {
      return null
    }

    listed.push(entry as ListedComment)
  }

  return listed
}

type Holder = XmlElement | XmlFragment | XmlText

interface Units {
  tokens: string[]
  places: { type: Holder; index: number }[]
  spans: Map<object, { start: number; end: number }>
}

// A text's characters one to a unit; an embed, which the binding never writes, is one unit too
function addTokens(tokens: string[], insert: unknown) {
  if (typeof insert !== 'string') {
    tokens.push('embed')
    return
  }

  for (let index = 0; index < insert.length; index += 1) {
    tokens.push(insert[index])
  }
}

function isUnitAtom(child: unknown, schema: Schema): child is XmlElement {
  if (!(child instanceof XmlElement)) {
    return false
  }

  const node = schema.nodes[child.nodeName]
  return !!node?.isInline && node.isLeaf && !MEDIA.has(child.nodeName)
}

function addTextUnits(text: XmlText, units: Units) {
  const start = units.tokens.length
  for (const { insert } of text.toDelta() as { insert: unknown }[]) {
    addTokens(units.tokens, insert)
  }

  for (let index = start; index < units.tokens.length; index += 1) {
    units.places.push({ type: text, index: index - start })
  }
}

function addChildUnits(
  parent: XmlElement | XmlFragment,
  child: unknown,
  index: number,
  schema: Schema,
  units: Units,
) {
  if (isUnitAtom(child, schema)) {
    units.spans.set(child, { start: units.tokens.length, end: units.tokens.length + 1 })
    units.tokens.push(child.nodeName)
    units.places.push({ type: parent, index })
  } else if (child instanceof XmlElement || child instanceof XmlText) {
    addUnits(child, schema, units)
  }
}

function addUnits(type: Holder, schema: Schema, units: Units) {
  const start = units.tokens.length
  if (type instanceof XmlText) {
    addTextUnits(type, units)
  } else {
    for (const [index, child] of type.toArray().entries()) {
      addChildUnits(type, child, index, schema, units)
    }
  }

  units.spans.set(type, { start, end: units.tokens.length })
}

/**
 * The words of `body` one unit to a place, a character or an inline atom such as a mention, with
 * where each holder starts and ends among them; media holds none
 */
export function bodyUnits(body: XmlFragment, schema: Schema) {
  const units: Units = { tokens: [], places: [], spans: new Map() }
  addUnits(body, schema, units)
  return units
}

// The unit a place in `type` comes before, or null when the walk never reached `type`
function unitAt(units: Units, type: object, index: number) {
  const span = units.spans.get(type)
  if (!span) {
    return null
  }

  if (type instanceof XmlText) {
    return span.start + index
  }

  const child = (type as XmlElement | XmlFragment).get(index)
  if (child === undefined) {
    return span.end
  }

  return units.spans.get(child)?.start ?? null
}

const UNREADABLE = 'unreadable'

// The unit one stored end of an old comment comes before
function oldEnd(old: Doc, units: Units, end: unknown) {
  if (end == null) {
    return null
  }

  if (!(end instanceof Uint8Array)) {
    return UNREADABLE
  }

  let position: RelativePosition
  try {
    position = decodeRelativePosition(end)
  } catch {
    return UNREADABLE
  }

  const absolute = createAbsolutePositionFromRelativePosition(position, old)
  if (!absolute) {
    return null
  }

  return unitAt(units, absolute.type, absolute.index) ?? UNREADABLE
}

/**
 * Which units of `old` each listed comment covers, read before the conversion rewrites anything;
 * a comment whose words are gone is deleted, and an end that can't be read gives null
 */
export function oldRanges(old: Doc, units: Units, comments: ListedComment[]) {
  const ranges: { id: string; from: number; to: number }[] = []
  const deleted: string[] = []
  for (const { id, anchor } of comments) {
    if (anchor == null) {
      deleted.push(id)
      continue
    }

    if (!isPlainObject(anchor)) {
      return null
    }

    const from = oldEnd(old, units, anchor.from)
    const to = oldEnd(old, units, anchor.to)
    if (from === UNREADABLE || to === UNREADABLE) {
      return null
    }

    if (from === null || to === null || to <= from) {
      deleted.push(id)
    } else {
      ranges.push({ id, from, to })
    }
  }

  return { ranges, deleted }
}

function unitRun({ type, index }: Units['places'][number]): Run {
  return { type, from: index, to: index + 1 }
}

function isSameUpTo(units: { old: Units; fresh: Units }, last: number) {
  for (let unit = 0; unit < last; unit += 1) {
    if (units.old.tokens[unit] !== units.fresh.tokens[unit]) {
      return false
    }
  }

  return true
}

/**
 * Each range's anchor in the fresh `body`, on the same units; null when the fresh body doesn't
 * hold the old units in the same order up to the last range, or a range can't be placed
 */
export function rangeAnchors(
  body: XmlFragment,
  schema: Schema,
  units: { old: Units; fresh: Units },
  ranges: { id: string; from: number; to: number }[],
) {
  if (!isSameUpTo(units, Math.max(0, ...ranges.map(({ to }) => to)))) {
    return null
  }

  const built = initProseMirrorDoc(body, schema)
  const anchors: Record<string, string> = {}
  for (const { id, from, to } of ranges) {
    const start = placedRun(body, built, unitRun(units.fresh.places[from]))
    const end = placedRun(body, built, unitRun(units.fresh.places[to - 1]))
    if (!start || !end) {
      return null
    }

    const quote = quoteBetween(built.doc, start.fromPlace, end.toPlace)
    anchors[id] = encodeAnchor(start.from, end.to, quote)
  }

  return anchors
}

// A node's own words as the old editor read them, an atom such as a mention as nothing
function ownText(node: PMNode) {
  if (node.isText) {
    return node.text ?? ''
  }

  if (node.isLeaf) {
    return node.type.spec.leafText?.(node) ?? ''
  }

  return ''
}

function addWords(words: Words, text: string, starts: number[], ends: number[]) {
  words.text += text
  for (const [index, start] of starts.entries()) {
    words.starts.push(start)
    words.ends.push(ends[index])
  }
}

interface Words {
  text: string
  starts: number[]
  ends: number[]
}

// A node's words, a character at its own place, an atom's own text over the whole atom
function addNodeWords(words: Words, node: PMNode, pos: number) {
  const own = ownText(node)
  const offsets = [...Array(own.length).keys()]
  if (node.isText) {
    addWords(
      words,
      own,
      offsets.map((index) => pos + index),
      offsets.map((index) => pos + index + 1),
    )
  } else {
    addWords(
      words,
      own,
      offsets.map(() => pos),
      offsets.map(() => pos + node.nodeSize),
    )
  }
}

// The words of `doc` as the old editor read them for a comment, blocks a space apart, each with
// the places it starts and ends; a block's space starts nowhere
function readWords(doc: PMNode) {
  const words: Words = { text: '', starts: [], ends: [] }
  let isFirst = true
  doc.descendants((node, pos) => {
    const isWordBlock = node.isBlock && (node.isTextblock || !!ownText(node))
    if (isWordBlock && !isFirst) {
      addWords(words, ' ', [-1], [pos + 1])
    }

    if (isWordBlock) {
      isFirst = false
    }

    addNodeWords(words, node, pos)
  })
  return words
}

// Where `words` start in `text`, overlaps counted, until a second is found
function startsOf(text: string, words: string) {
  const found: number[] = []
  let at = text.indexOf(words)
  while (at >= 0 && found.length <= 1) {
    found.push(at)
    at = text.indexOf(words, at + 1)
  }

  return found
}

// The places of the one stretch that reads as `words`, or null when there isn't exactly one
function onlyPlaceOf({ text, starts, ends }: Words, words: unknown) {
  if (typeof words !== 'string' || !words.trim()) {
    return null
  }

  const found = startsOf(text, words)
  if (found.length !== 1 || starts[found[0]] < 0) {
    return null
  }

  return { from: starts[found[0]], to: ends[found[0] + words.length - 1] }
}

// The place `position` is at, held by the character after it (0) or before it (-1)
function heldAt(body: XmlFragment, position: RelativePosition, assoc: number) {
  const absolute = createAbsolutePositionFromRelativePosition(position, body.doc!)!
  return createRelativePositionFromTypeIndex(absolute.type, absolute.index, assoc)
}

// The anchor on `from` to `to`, or null when it wouldn't read back as `words`
function wordAnchor(
  body: XmlFragment,
  built: ReturnType<typeof initProseMirrorDoc>,
  { from, to }: { from: number; to: number },
  words: string,
) {
  const { doc, mapping, meta } = built
  const start = heldAt(
    body,
    absolutePositionToRelativePosition(from, body, mapping, meta.hidden),
    0,
  )
  const end = heldAt(body, absolutePositionToRelativePosition(to, body, mapping, meta.hidden), -1)
  const back = [placeOf(body, built, start), placeOf(body, built, end)]
  if (back.includes(null) || doc.textBetween(back[0]!, back[1]!, ' ') !== words) {
    return null
  }

  return encodeAnchor(start, end, quoteBetween(doc, from, to))
}

/**
 * Each listed comment's anchor in the fresh `body`, found by its words where they are once; a
 * comment whose words aren't there once is deleted, and null when an anchor wouldn't read back as
 * its words
 */
export function wordAnchors(body: XmlFragment, schema: Schema, comments: ListedComment[]) {
  const built = initProseMirrorDoc(body, schema)
  const words = readWords(built.doc)
  const anchors: Record<string, string> = {}
  const deleted: string[] = []
  for (const { id, anchorText } of comments) {
    const place = onlyPlaceOf(words, anchorText)
    if (!place) {
      deleted.push(id)
      continue
    }

    const anchor = wordAnchor(body, built, place, anchorText as string)
    if (!anchor) {
      return null
    }

    anchors[id] = anchor
  }

  return { anchors, deleted }
}
