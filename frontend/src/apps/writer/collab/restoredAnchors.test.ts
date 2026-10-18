import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { encodeAnchor, readAnchor } from './anchors'
import { BODY_FIELD } from './field'
import { restoreEdit } from './restore'
import { restoredAnchors } from './restoredAnchors'

const LINEAGE = 'lineage-1'

// A document of one paragraph per text
function documentOf(...texts: string[]) {
  const doc = new Y.Doc()
  const paragraphs = texts.map((value) => {
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText(value)])
    return paragraph
  })
  doc.getXmlFragment(BODY_FIELD).insert(0, paragraphs)
  return doc
}

function textOf(doc: Y.Doc, paragraph: number) {
  const element = doc.getXmlFragment(BODY_FIELD).get(paragraph) as Y.XmlElement
  return element.get(0) as Y.XmlText
}

// An anchor on characters `from` to `to` of a paragraph, as a selection makes it
function anchorOn(doc: Y.Doc, paragraph: number, from: number, to: number) {
  const text = textOf(doc, paragraph)
  const quote = text.toString().slice(from, to)
  return encodeAnchor(
    Y.createRelativePositionFromTypeIndex(text, from, 0),
    Y.createRelativePositionFromTypeIndex(text, to, -1),
    quote,
  )
}

// The words an anchor covers in the document now
function covered(doc: Y.Doc, anchor: string) {
  const read = readAnchor(anchor)
  if (read.kind !== 'text') {
    return null
  }

  const from = Y.createAbsolutePositionFromRelativePosition(read.start, doc)!
  const to = Y.createAbsolutePositionFromRelativePosition(read.end, doc)!
  return (from.type as Y.XmlText).toString().slice(from.index, to.index)
}

function versionOf(doc: Y.Doc) {
  return { lineage: LINEAGE, state: Y.encodeStateAsUpdate(doc) }
}

describe('threads after a restore', () => {
  it('brings a thread back onto text deleted after the version, which edits then carry', () => {
    const doc = documentOf('hello world')
    const anchor = anchorOn(doc, 0, 6, 11)
    const version = versionOf(doc)
    textOf(doc, 0).delete(5, 6)

    restoreEdit(doc, LINEAGE, version)
    const anchors = restoredAnchors(doc, LINEAGE, version, [{ name: 't1', anchor }])
    textOf(doc, 0).insert(0, 'Oh, ')

    expect([covered(doc, anchors.t1), readAnchor(anchors.t1)]).toMatchObject([
      'world',
      { quote: 'world' },
    ])
  })

  it('brings a thread back into a paragraph deleted whole', () => {
    const doc = documentOf('first', 'second line')
    const anchor = anchorOn(doc, 1, 0, 6)
    const version = versionOf(doc)
    doc.getXmlFragment(BODY_FIELD).delete(1, 1)

    restoreEdit(doc, LINEAGE, version)
    const anchors = restoredAnchors(doc, LINEAGE, version, [{ name: 't1', anchor }])

    expect(covered(doc, anchors.t1)).toBe('second')
  })

  it('stretches a thread back over its deleted end', () => {
    const doc = documentOf('hello world')
    const anchor = anchorOn(doc, 0, 0, 11)
    const version = versionOf(doc)
    textOf(doc, 0).delete(6, 5)

    restoreEdit(doc, LINEAGE, version)
    const anchors = restoredAnchors(doc, LINEAGE, version, [{ name: 't1', anchor }])

    expect(covered(doc, anchors.t1)).toBe('hello world')
  })

  it('never touches a thread still on its text', () => {
    const doc = documentOf('hello world')
    const anchor = anchorOn(doc, 0, 0, 5)
    const version = versionOf(doc)
    textOf(doc, 0).insert(11, '!')

    restoreEdit(doc, LINEAGE, version)

    expect(restoredAnchors(doc, LINEAGE, version, [{ name: 't1', anchor }])).toEqual({})
  })

  it('leaves a thread whose text was gone before the version', () => {
    const doc = documentOf('old words')
    const anchor = anchorOn(doc, 0, 0, 3)
    textOf(doc, 0).delete(0, 4)
    const version = versionOf(doc)
    textOf(doc, 0).insert(0, 'new ')

    restoreEdit(doc, LINEAGE, version)

    expect(restoredAnchors(doc, LINEAGE, version, [{ name: 't1', anchor }])).toEqual({})
  })

  it('moves nothing for a version without this document’s Yjs identity', () => {
    const doc = documentOf('hello world')
    const anchor = anchorOn(doc, 0, 6, 11)
    const other = { lineage: 'lineage-2', state: Y.encodeStateAsUpdate(doc) }
    textOf(doc, 0).delete(5, 6)
    const threads = [{ name: 't1', anchor }]

    const moved = [
      restoredAnchors(doc, LINEAGE, other, threads),
      restoredAnchors(doc, LINEAGE, { html: '<p>hello world</p>' }, threads),
    ]

    expect(moved).toEqual([{}, {}])
  })

  it('brings a thread back onto its own text after an old video that opens a list item', () => {
    const doc = new Y.Doc()
    const video = new Y.XmlElement('resizableMedia')
    video.setAttribute('src', '/files/demo.mp4')
    video.setAttribute('media-type', 'video')
    const [first, second] = ['A text', 'B text'].map((value) => {
      const paragraph = new Y.XmlElement('paragraph')
      paragraph.insert(0, [new Y.XmlText(value)])
      return paragraph
    })
    const item = new Y.XmlElement('listItem')
    item.insert(0, [video, first, second])
    const list = new Y.XmlElement('bulletList')
    list.insert(0, [item])
    doc.getXmlFragment(BODY_FIELD).insert(0, [list])
    const text = second.get(0) as Y.XmlText
    const anchor = encodeAnchor(
      Y.createRelativePositionFromTypeIndex(text, 0, 0),
      Y.createRelativePositionFromTypeIndex(text, 6, -1),
      'B text',
    )
    const version = versionOf(doc)
    item.delete(2, 1)

    restoreEdit(doc, LINEAGE, version)
    const anchors = restoredAnchors(doc, LINEAGE, version, [{ name: 't1', anchor }])

    expect(covered(doc, anchors.t1)).toBe('B text')
  })
})
