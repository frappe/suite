import { AbstractType, applyUpdate, Doc, encodeStateAsUpdate, XmlElement, XmlFragment } from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'

// The old editor's resizable image or video, which this editor has no node for
const OLD_MEDIA = 'resizableMedia'
const ALIGNMENTS = ['left', 'center', 'right']
const FLOATS = ['left', 'right']
// A list item opens with a paragraph, so a video can't come first
const LIST_ITEMS = ['listItem', 'taskItem']

type Parent = XmlFragment | XmlElement

function isOldMedia(type: AbstractType<unknown>) {
  return type instanceof XmlElement && type.nodeName === OLD_MEDIA
}

function pixels(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }

  return null
}

// Laid out as the old editor showed it (alignment over float, neither means left); a size in
// percent or 'auto' has no pixel form, so the editor measures the media instead. The old editor
// stored an image's resized height as NaN, so a pixel width stands on its own
function mediaAttributes(old: XmlElement) {
  const stored = old.getAttributes() as Record<string, unknown>
  const attributes: Record<string, unknown> = { align: 'left' }
  for (const key of ['src', 'alt', 'title']) {
    if (stored[key] != null) {
      attributes[key] = stored[key]
    }
  }

  if (ALIGNMENTS.includes(stored.dataAlign as string)) {
    attributes.align = stored.dataAlign
  } else if (FLOATS.includes(stored.dataFloat as string)) {
    attributes.float = stored.dataFloat
  }

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

function element(name: string, attributes: Record<string, unknown>, children: XmlElement[] = []) {
  const node = new XmlElement(name)
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value as string)
  }

  node.insert(0, children)
  return node
}

function converted(old: XmlElement, parent: Parent, index: number) {
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
  const olds = [...body.createTreeWalker(isOldMedia)] as XmlElement[]
  for (const old of olds) {
    const parent = old.parent as Parent
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
