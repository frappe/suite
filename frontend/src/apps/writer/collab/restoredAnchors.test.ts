import { describe, expect, it } from 'vitest'
import * as yjs from 'yjs'

import { encodeAnchor, readAnchor } from './anchors'
import { BODY_FIELD } from './field'
import { restoreEdit } from './restore'
import { restoredAnchors } from './restoredAnchors'

const LINEAGE = 'lineage-1'

// A document of one paragraph per text
function documentOf(...texts: string[]) {
  const doc = new yjs.Doc()
  const paragraphs = texts.map((value) => {
    const paragraph = new yjs.XmlElement('paragraph')
    paragraph.insert(0, [new yjs.XmlText(value)])
    return paragraph
  })
  doc.getXmlFragment(BODY_FIELD).insert(0, paragraphs)
  return doc
}

function textOf(doc: yjs.Doc, paragraph: number) {
  const element = doc.getXmlFragment(BODY_FIELD).get(paragraph) as yjs.XmlElement
  return element.get(0) as yjs.XmlText
}

// An anchor on characters `from` to `to` of a paragraph, as a selection makes it
function anchorOn(doc: yjs.Doc, paragraph: number, from: number, to: number) {
  const text = textOf(doc, paragraph)
  const quote = text.toString().slice(from, to)
  return encodeAnchor(
    yjs.createRelativePositionFromTypeIndex(text, from, 0),
    yjs.createRelativePositionFromTypeIndex(text, to, -1),
    quote,
  )
}

// The words an anchor covers in the document now
function covered(doc: yjs.Doc, anchor: string) {
  const read = readAnchor(anchor)
  if (read.kind !== 'text') {
    return null
  }

  const from = yjs.createAbsolutePositionFromRelativePosition(read.start, doc)!
  const to = yjs.createAbsolutePositionFromRelativePosition(read.end, doc)!
  return (from.type as yjs.XmlText).toString().slice(from.index, to.index)
}

function versionOf(doc: yjs.Doc) {
  return { lineage: LINEAGE, state: yjs.encodeStateAsUpdate(doc) }
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
    const other = { lineage: 'lineage-2', state: yjs.encodeStateAsUpdate(doc) }
    textOf(doc, 0).delete(5, 6)
    const threads = [{ name: 't1', anchor }]

    const moved = [
      restoredAnchors(doc, LINEAGE, other, threads),
      restoredAnchors(doc, LINEAGE, { html: '<p>hello world</p>' }, threads),
    ]

    expect(moved).toEqual([{}, {}])
  })

  it('brings a thread back onto its own text after an old video that opens a list item', () => {
    const doc = new yjs.Doc()
    const video = new yjs.XmlElement('resizableMedia')
    video.setAttribute('src', '/files/demo.mp4')
    video.setAttribute('media-type', 'video')
    const [first, second] = ['A text', 'B text'].map((value) => {
      const paragraph = new yjs.XmlElement('paragraph')
      paragraph.insert(0, [new yjs.XmlText(value)])
      return paragraph
    })
    const item = new yjs.XmlElement('listItem')
    item.insert(0, [video, first, second])
    const list = new yjs.XmlElement('bulletList')
    list.insert(0, [item])
    doc.getXmlFragment(BODY_FIELD).insert(0, [list])
    const text = second.get(0) as yjs.XmlText
    const anchor = encodeAnchor(
      yjs.createRelativePositionFromTypeIndex(text, 0, 0),
      yjs.createRelativePositionFromTypeIndex(text, 6, -1),
      'B text',
    )
    const version = versionOf(doc)
    item.delete(2, 1)

    restoreEdit(doc, LINEAGE, version)
    const anchors = restoredAnchors(doc, LINEAGE, version, [{ name: 't1', anchor }])

    expect(covered(doc, anchors.t1)).toBe('B text')
  })
})
