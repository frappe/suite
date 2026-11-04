import { Editor, getSchema } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Heading from '@tiptap/extension-heading'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import {
  absolutePositionToRelativePosition,
  initProseMirrorDoc,
  yXmlFragmentToProsemirrorJSON,
} from '@tiptap/y-tiptap'
import { afterEach } from 'vitest'
import {
  applyUpdate,
  Doc,
  encodeRelativePosition,
  encodeStateAsUpdate,
  XmlElement,
  XmlText,
} from 'yjs'

import { convertLegacy } from '@/apps/writer/collab/conversion'
import { BODY_FIELD } from '@/apps/writer/collab/field'
import type { LegacyBody } from '@/apps/writer/collab/legacy-read'
import { placeThread } from '@/apps/writer/collab/places'
import { tabEditor } from '@/apps/writer/collab/tab-editor'
import { HeadingAnchors } from '@/apps/writer/extensions/heading-anchors'
import { writerSchema } from '@/apps/writer/schema'

const schema = getSchema(writerSchema())
const KIB = 1024
const MAX_STATE_MIB = 4
const HEADING_LEVEL = 2
export const MAX_STATE = MAX_STATE_MIB * KIB * KIB
export const SRC = '/private/files/chart.png'
// Drive's ink as it saved it on text left at its default
export const INK = 'style="color: rgb(31, 39, 46)"'

// A thread as Drive's earlier editor kept it in the comment mark
export const DRIVE_THREAD = JSON.stringify({
  uuid: 'u1',
  comments: [{ userName: 'Ann', userImage: null, time: 1700000000000, content: '<p>see</p>' }],
})

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

export function yElement(name: string, ...children: (XmlElement | XmlText)[]) {
  const node = new XmlElement(name)
  node.insert(0, children)
  return node
}

export function yParagraph(text: string) {
  return yElement('paragraph', new XmlText(text))
}

export function yMarked(text: string, attributes: Record<string, unknown>) {
  const content = new XmlText()
  content.insert(0, text, attributes)
  return yElement('paragraph', content)
}

export function yRuns(...pieces: [string, Record<string, unknown>?][]) {
  const content = new XmlText()
  let at = 0
  for (const [piece, attributes] of pieces) {
    content.insert(at, piece, attributes ?? {})
    at += piece.length
  }

  return yElement('paragraph', content)
}

export function yHeading(text: string, id?: string) {
  const node = yElement('heading', new XmlText(text))
  node.setAttribute('level', HEADING_LEVEL as never)
  if (id) {
    node.setAttribute('data-toc-id', id)
  }

  return node
}

export function yAtom(name: string, attributes: Record<string, string>) {
  const node = new XmlElement(name)
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value)
  }

  return node
}

export function withChildren(node: XmlElement, ...children: (XmlElement | XmlText)[]) {
  node.insert(0, children)
  return node
}

export function oldMedia(attributes: Record<string, unknown>) {
  const node = new XmlElement('resizableMedia')
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value as string)
  }

  return node
}

export function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

export function legacyDoc(...blocks: XmlElement[]) {
  const doc = new Doc()
  doc.getXmlFragment(BODY_FIELD).insert(0, blocks)
  return doc
}

export function stored(doc: Doc): LegacyBody {
  return { content: toBase64(encodeStateAsUpdate(doc)), html: '', collab: 1, ycomments: null }
}

// An old comment as Writer kept it beside the body, each end where the old editor put it in `doc`
export function oldComment(doc: Doc, id: string, from: number, to: number) {
  const body = doc.getXmlFragment(BODY_FIELD)
  const { mapping, meta } = initProseMirrorDoc(body, schema)
  function end(place: number) {
    return encodeRelativePosition(
      absolutePositionToRelativePosition(place, body, mapping, meta.hidden),
    )
  }

  return { ...htmlComment(id, ''), anchor: { from: end(from), to: end(to) } }
}

// An old comment on a document saved as HTML, found again by its words
export function htmlComment(id: string, anchorText: string) {
  return {
    id,
    new: false,
    creation: 1700000000000,
    owner: 'ann@example.com',
    replies: [],
    anchorText,
  }
}

// Old Writer's list of comments, by key, as the row stores it
export function yComments(entries: Record<string, object>) {
  const doc = new Doc()
  const comments = doc.getMap('comments')
  for (const [key, entry] of Object.entries(entries)) {
    comments.set(key, entry)
  }

  return toBase64(encodeStateAsUpdate(doc))
}

export function convert(legacy: LegacyBody) {
  const result = convertLegacy(legacy, MAX_STATE)
  if (result.kind !== 'converted') {
    throw new Error(result.reason)
  }

  return result
}

export function opened(state: Uint8Array) {
  const doc = new Doc()
  applyUpdate(doc, state)
  return doc
}

export function bodyOf(state: Uint8Array) {
  const json = yXmlFragmentToProsemirrorJSON(opened(state).getXmlFragment(BODY_FIELD))
  return schema.nodeFromJSON(json).toJSON()
}

// The converted state open in an editor, the way a tab opens it
export function openConverted(state: Uint8Array) {
  const editor = tabEditor(opened(state))
  editors.push(editor)
  return editor
}

// Where the editor shows a thread and the words there
export function shown(editor: Editor, anchor: string) {
  const place = placeThread(editor.state, anchor)
  if (place.kind !== 'text') {
    return place.kind
  }

  return {
    from: place.from,
    to: place.to,
    text: editor.state.doc.textBetween(place.from, place.to),
  }
}

// Each stored run of a paragraph's text with the keys it holds
export function storedRuns(state: Uint8Array, index: number) {
  const block = opened(state).getXmlFragment(BODY_FIELD).get(index) as XmlElement
  const runs: { insert: string; attributes?: object }[] = (block.get(0) as XmlText).toDelta()
  return runs.map(({ insert, attributes }) => [insert, Object.keys(attributes ?? {})])
}

export function paragraph(...content: object[]) {
  return { type: 'paragraph', content }
}

export function words(text: string) {
  return paragraph({ type: 'text', text })
}

// Each run's text with the colours drawn on it
export function drawnColours(
  content: { text: string; marks?: { type: string; attrs: Record<string, unknown> }[] }[],
) {
  return content.map(({ text, marks = [] }) => [
    text,
    marks.filter(({ attrs }) => attrs.color != null).map(({ type, attrs }) => [type, attrs.color]),
  ])
}

export function page(...content: object[]) {
  return schema.nodeFromJSON({ type: 'doc', content }).toJSON()
}

// The ids the editor draws today on the old body's headings, read from the page
export function drawnIds(doc: Doc) {
  const element = document.createElement('div')
  document.body.append(element)
  const content = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(BODY_FIELD))
  const extensions = [Document, Paragraph, Text, Heading, HeadingAnchors]
  const editor = new Editor({ element, extensions, content })
  editors.push(editor)
  const headings = [...editor.view.dom.querySelectorAll('h2')]
  return headings.map((heading) => heading.getAttribute('data-toc-id'))
}

export function headingIds(state: Uint8Array) {
  const headings = bodyOf(state).content.filter(
    (block: { type: string }) => block.type === 'heading',
  )
  return headings.map((heading: { attrs: Record<string, unknown> }) => heading.attrs['data-toc-id'])
}
