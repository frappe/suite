import { describe, expect, it } from 'vitest'
import * as yjs from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { writerRender } from '@/apps/writer/collab/render'

function linkedDoc() {
  const doc = new yjs.Doc()
  const paragraph = new yjs.XmlElement('paragraph')
  const text = new yjs.XmlText()
  const image = new yjs.XmlElement('image')
  image.setAttribute('src', '/private/files/chart.png')
  paragraph.insert(0, [text, image])
  doc.getXmlFragment(BODY_FIELD).insert(0, [paragraph])
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
    const doc = new yjs.Doc()
    const blocks = ['First', 'Second'].map((words) => {
      const paragraph = new yjs.XmlElement('paragraph')
      paragraph.insert(0, [new yjs.XmlText(words)])
      return paragraph
    })
    doc.getXmlFragment(BODY_FIELD).insert(0, blocks)

    expect(writerRender(doc).text).toBe('First\nSecond')
  })

  it('writes nothing to the document, even over two texts it made side by side', () => {
    const doc = new yjs.Doc()
    const block = new yjs.XmlElement('paragraph')
    block.insert(0, [new yjs.XmlText('a'), new yjs.XmlText('b')])
    doc.getXmlFragment(BODY_FIELD).insert(0, [block])
    const before = yjs.encodeStateAsUpdate(doc)

    writerRender(doc)

    expect(yjs.encodeStateAsUpdate(doc)).toEqual(before)
  })

  it('shows an old image in the readable copy and leaves the document as it was', () => {
    const doc = new yjs.Doc()
    const old = new yjs.XmlElement('resizableMedia')
    old.setAttribute('src', '/private/files/chart.png')
    old.setAttribute('media-type', 'img')
    doc.getXmlFragment(BODY_FIELD).insert(0, [old])
    const before = yjs.encodeStateAsUpdate(doc)

    const { html } = writerRender(doc)

    expect(html).toMatch(/<img [^>]*src="\/private\/files\/chart\.png"/)
    expect(yjs.encodeStateAsUpdate(doc)).toEqual(before)
  })

  it("shows Drive's top-level image in a paragraph of its own", () => {
    const doc = new yjs.Doc()
    const words = new yjs.XmlElement('paragraph')
    words.insert(0, [new yjs.XmlText('See the plan')])
    const image = new yjs.XmlElement('image')
    image.setAttribute('src', '/private/files/chart.png')
    doc.getXmlFragment(BODY_FIELD).insert(0, [words, image])

    const { html, text } = writerRender(doc)

    expect(html).toMatch(/<img [^>]*src="\/private\/files\/chart\.png"/)
    expect(text).toBe('See the plan\n')
  })
})
