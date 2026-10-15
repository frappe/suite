import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { writerRender } from '@/apps/writer/collab/render'

function linkedDoc() {
  const doc = new Y.Doc()
  const paragraph = new Y.XmlElement('paragraph')
  const text = new Y.XmlText()
  paragraph.insert(0, [text])
  const image = new Y.XmlElement('image')
  image.setAttribute('src', '/private/files/chart.png')
  doc.getXmlFragment(BODY_FIELD).insert(0, [paragraph, image])
  text.insert(0, 'See ')
  text.insert(4, 'the plan', { link: { href: 'https://example.com/plan' } })
  return doc
}

describe('writerRender', () => {
  it('renders the body as HTML with its links and images, and as the text a reader sees', () => {
    const { html, text } = writerRender(linkedDoc())
    expect(html).toContain('href="https://example.com/plan"')
    expect(html).toContain('src="/private/files/chart.png"')
    expect(text).toBe('See the plan')
  })

  it('puts each block of text on its own line', () => {
    const doc = new Y.Doc()
    const blocks = ['First', 'Second'].map((words) => {
      const paragraph = new Y.XmlElement('paragraph')
      paragraph.insert(0, [new Y.XmlText(words)])
      return paragraph
    })
    doc.getXmlFragment(BODY_FIELD).insert(0, blocks)

    expect(writerRender(doc).text).toBe('First\nSecond')
  })

  it('writes nothing to the document, even over two texts it made side by side', () => {
    const doc = new Y.Doc()
    const block = new Y.XmlElement('paragraph')
    block.insert(0, [new Y.XmlText('a'), new Y.XmlText('b')])
    doc.getXmlFragment(BODY_FIELD).insert(0, [block])
    const before = Y.encodeStateAsUpdate(doc)

    writerRender(doc)

    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })

  it('shows an old image in the readable copy and leaves the document as it was', () => {
    const doc = new Y.Doc()
    const old = new Y.XmlElement('resizableMedia')
    old.setAttribute('src', '/private/files/chart.png')
    old.setAttribute('media-type', 'img')
    doc.getXmlFragment(BODY_FIELD).insert(0, [old])
    const before = Y.encodeStateAsUpdate(doc)

    const { html } = writerRender(doc)

    expect(html).toMatch(/<img [^>]*src="\/private\/files\/chart\.png"/)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })
})
