import { getSchema } from '@tiptap/core'
import { AbstractType, applyUpdate, Doc, encodeStateAsUpdate, XmlElement, XmlFragment } from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { writerSchema } from '@/apps/writer/schema'

const schema = getSchema(writerSchema())
// The old editor's resizable image or video, which this editor has no node for
const OLD_MEDIA = 'resizableMedia'
// Drive's earlier image was a block, which this editor holds only among text
const OLD_IMAGE = 'image'
const ALIGNMENTS = ['left', 'center', 'right']
const FLOATS = ['left', 'right']
// All the old editor's resizable media ever declared
const OLD_MEDIA_KEYS = new Set([
  'src',
  'media-type',
  'alt',
  'title',
  'width',
  'height',
  'dataAlign',
  'dataFloat',
])
const OLD_MEDIA_KINDS = ['img', 'video']
// A list item opens with a paragraph, so a video can't come first
const LIST_ITEMS = ['listItem', 'taskItem']

export type Parent = XmlFragment | XmlElement

// An image at the top or in a part that holds blocks; a part the editor doesn't know is left alone
function isBlockImage(type: XmlElement) {
  const { parent } = type
  if (!(parent instanceof XmlElement)) {
    return true
  }

  return schema.nodes[parent.nodeName]?.inlineContent === false
}

function isOldMedia(type: AbstractType<unknown>) {
  if (!(type instanceof XmlElement)) {
    return false
  }

  return type.nodeName === OLD_MEDIA || (type.nodeName === OLD_IMAGE && isBlockImage(type))
}

function pixels(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }

  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }

  return null
}

/** Whether old media's layout is one the old editor wrote, each name unset or among its values. */
export function isOldLayout(dataAlign: unknown, dataFloat: unknown) {
  const isAlignment = dataAlign == null || ALIGNMENTS.some((alignment) => alignment === dataAlign)
  return isAlignment && (dataFloat == null || FLOATS.some((placement) => placement === dataFloat))
}
interface OldLayoutResult {
  align: string
  float?: string
}

/** Old media laid out as the old editor showed it: alignment over float, neither means left. */
export function oldLayout(dataAlign: unknown, dataFloat: unknown): OldLayoutResult {
  if (ALIGNMENTS.some((alignment) => alignment === dataAlign)) {
    return { align: String(dataAlign) }
  }

  if (FLOATS.some((placement) => placement === dataFloat)) {
    return { align: 'left', float: String(dataFloat) }
  }

  return { align: 'left' }
}

// A size in percent or 'auto' has no pixel form, so the editor measures the media instead. The old
// editor stored an image's resized height as a number that isn't finite, so a pixel width stands on
// its own
interface LegacyMediaAttributes {
  align: string
  width?: number
  height?: number
  [attribute: string]: unknown
}

function mediaAttributes(old: XmlElement) {
  const stored: Record<string, unknown> = old.getAttributes()
  const attributes: LegacyMediaAttributes = { align: 'left' }
  for (const key of ['src', 'alt', 'title']) {
    if (stored[key] != null) {
      attributes[key] = stored[key]
    }
  }

  Object.assign(attributes, oldLayout(stored.dataAlign, stored.dataFloat))
  const width = pixels(stored.width)
  const height = pixels(stored.height)
  if (width !== null) {
    attributes.width = width
  }

  if (width !== null && height !== null) {
    attributes.height = height
  }

  return attributes
}

// A size the old editor wrote: unset, its default or pixels; a pixel height needs a pixel width
function isOldSize({ width, height }: Record<string, unknown>) {
  const isWidth = width == null || width === '100%' || pixels(width) !== null
  if (pixels(height) !== null) {
    return pixels(width) !== null
  }

  const isUnmeasured = typeof height === 'number' && !Number.isFinite(height)
  return isWidth && (height == null || height === 'auto' || isUnmeasured)
}

function isMappable(old: XmlElement) {
  const stored: Record<string, unknown> = old.getAttributes()
  const keys = Object.keys(stored).filter((key) => stored[key] != null)
  const kind = stored['media-type']
  return (
    keys.every((key) => OLD_MEDIA_KEYS.has(key)) &&
    (kind == null || OLD_MEDIA_KINDS.some((mediaKind) => mediaKind === kind)) &&
    isOldLayout(stored.dataAlign, stored.dataFloat) &&
    isOldSize(stored)
  )
}

function resizableMedia(body: XmlFragment) {
  const olds = body.createTreeWalker(
    (type) => type instanceof XmlElement && type.nodeName === OLD_MEDIA,
  )
  return [...olds].filter((node) => node instanceof XmlElement)
}

/** Whether all old resizable media under `body` holds only what the old editor wrote. */
export function isOldMediaMappable(body: XmlFragment) {
  return resizableMedia(body).every(isMappable)
}

/** Whether old resizable media under `body` sets both layouts, so its float isn't shown. */
export function isFloatDropped(body: XmlFragment) {
  return resizableMedia(body).some(
    (old) => old.getAttribute('dataAlign') != null && old.getAttribute('dataFloat') != null,
  )
}

function element(name: string, attributes: Record<string, unknown>, children: XmlElement[] = []) {
  const node = new XmlElement(name)
  for (const [key, value] of Object.entries(attributes)) {
    // SAFETY: these media attributes include numeric dimensions, which Yjs preserves
    // unchanged even though XmlElement's default attribute generic describes strings.
    node.setAttribute(key, value as string)
  }

  node.insert(0, children)
  return node
}

// Drive's block image keeps all it stored; with no alignment it's at the left, as old media is
function keptImage(old: XmlElement) {
  const stored: Record<string, unknown> = old.getAttributes()
  return element('image', { ...stored, align: stored.align ?? 'left' })
}

function converted(old: XmlElement, parent: Parent, index: number) {
  if (old.nodeName === OLD_IMAGE) {
    return [element('paragraph', {}, [keptImage(old)])]
  }

  const attributes = mediaAttributes(old)
  if (old.getAttribute('media-type') !== 'video') {
    return [element('paragraph', {}, [element('image', attributes)])]
  }

  const video = element('video', attributes)
  const isListOpening =
    index === 0 && parent instanceof XmlElement && LIST_ITEMS.includes(parent.nodeName)
  if (!isListOpening) {
    return [video]
  }

  return [element('paragraph', {}), video]
}

// Each old image becomes an image in its own paragraph, and each old video a video
export function convertOldMedia(body: XmlFragment) {
  const olds = [...body.createTreeWalker(isOldMedia)].filter((node) => node instanceof XmlElement)
  for (const old of olds) {
    const parent = old.parent
    if (!(parent instanceof XmlElement) && !(parent instanceof XmlFragment))
      throw new Error('Legacy media has no fragment parent')
    const index = parent.toArray().indexOf(old)
    const replacement = converted(old, parent, index)
    parent.delete(index, 1)
    parent.insert(index, replacement)
  }
}

// Fills `doc` with a stored version's state, its old media converted; every reader of a version opens it here
export function loadVersion(doc: Doc, state: Uint8Array) {
  applyUpdate(doc, state)
  convertOldMedia(doc.getXmlFragment(BODY_FIELD))
}

// The body with its old media converted, on a copy, so the document itself is unchanged
export function withOldMediaConverted(doc: Doc) {
  const body = doc.getXmlFragment(BODY_FIELD)
  const hasOldMedia = !body.createTreeWalker(isOldMedia).next().done
  if (!hasOldMedia) {
    return body
  }

  const copy = new Doc()
  applyUpdate(copy, encodeStateAsUpdate(doc))
  const copied = copy.getXmlFragment(BODY_FIELD)
  convertOldMedia(copied)
  return copied
}
