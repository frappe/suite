import { describe, expect, it } from 'vitest'
import * as yjs from 'yjs'

import anchorForms from './anchor-forms.json'
import { ANCHOR_LIMIT, DOCUMENT_ANCHOR, encodeAnchor, readAnchor } from './anchors'

function paragraph(words: string) {
  const doc = new yjs.Doc()
  const element = new yjs.XmlElement('paragraph')
  const text = new yjs.XmlText()
  doc.getXmlFragment('default').insert(0, [element])
  element.insert(0, [text])
  text.insert(0, words)
  return { doc, text }
}

function range(text: yjs.XmlText, from: number, to: number) {
  return [
    yjs.createRelativePositionFromTypeIndex(text, from, 0),
    yjs.createRelativePositionFromTypeIndex(text, to, -1),
  ] as const
}

function codePoints(text: string) {
  return [...text].length
}

describe('anchors', () => {
  it('keeps a range on its words after it is stored and read back', () => {
    const { doc, text } = paragraph('hello brave world')
    const [start, end] = range(text, 6, 11)

    const anchor = readAnchor(encodeAnchor(start, end, 'brave'))
    text.insert(0, 'oh ')

    expect(anchor.kind).toBe('text')
    if (anchor.kind !== 'text') {
      return
    }

    const from = yjs.createAbsolutePositionFromRelativePosition(anchor.start, doc)!.index
    const to = yjs.createAbsolutePositionFromRelativePosition(anchor.end, doc)!.index
    expect([text.toString().slice(from, to), anchor.quote]).toEqual(['brave', 'brave'])
  })

  it('cuts a long quote to 150 characters', () => {
    const { text } = paragraph('x')
    const [start, end] = range(text, 0, 1)

    const anchor = readAnchor(encodeAnchor(start, end, 'a'.repeat(400)))

    expect(anchor.kind === 'text' && anchor.quote).toBe('a'.repeat(150))
  })

  it('cuts a quote whose escapes overflow Drive until the anchor fits', () => {
    const { text } = paragraph('x')
    const [start, end] = range(text, 0, 1)

    const stored = encodeAnchor(start, end, '"'.repeat(150))
    const anchor = readAnchor(stored)

    expect(codePoints(stored)).toBeLessThanOrEqual(ANCHOR_LIMIT)
    expect(codePoints(stored)).toBeGreaterThan(ANCHOR_LIMIT - 2)
    expect(anchor.kind === 'text' && anchor.quote).toMatch(/^"+$/)
  })

  it('counts an emoji as one character, as Drive does', () => {
    const { text } = paragraph('x')
    const [start, end] = range(text, 0, 1)

    const anchor = readAnchor(encodeAnchor(start, end, '😀'.repeat(150)))

    expect(anchor.kind === 'text' && anchor.quote).toBe('😀'.repeat(150))
  })

  it('reads the whole-document anchor', () => {
    expect(readAnchor(DOCUMENT_ANCHOR)).toEqual({ kind: 'document' })
  })

  it('leaves an old comment id or a broken anchor unplaced', () => {
    const broken = [
      '9f3c1e2a7b',
      '{"v":2,"s":"","e":"","q":""}',
      '{"v":1,"s":"%%","e":"","q":""}',
      'null',
    ]

    expect(broken.map((anchor) => readAnchor(anchor).kind)).toEqual([
      'unplaced',
      'unplaced',
      'unplaced',
      'unplaced',
    ])
  })

  it('reads a deleted anchor with its quote', () => {
    expect(readAnchor('{"v":1,"q":""}')).toEqual({ kind: 'deleted', quote: '' })
    expect(readAnchor('{"v":1,"q":"gone words"}')).toEqual({ kind: 'deleted', quote: 'gone words' })
  })

  // The forms a stored thread anchor can take, and broken ones that read as unplaced
  it.each(anchorForms)('reads $anchor as $kind', ({ anchor, kind }) => {
    expect(readAnchor(anchor).kind).toBe(kind)
  })
})
