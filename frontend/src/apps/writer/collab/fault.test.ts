import { judge } from '@suite/collab-client'
import { describe, expect, it } from 'vitest'
import * as yjs from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab'
import { writerFault } from '@/apps/writer/collab/fault'

function paragraph(text: string) {
  const node = new yjs.XmlElement('paragraph')
  node.insert(0, [new yjs.XmlText(text)])
  return node
}

function wrappedParagraph(name: string) {
  const node = new yjs.XmlElement(name)
  node.insert(0, [paragraph(name)])
  return node
}

function docWithBody(build: (fragment: yjs.XmlFragment) => void) {
  const doc = new yjs.Doc()
  build(doc.getXmlFragment(BODY_FIELD))
  return doc
}

describe('writerFault', () => {
  it('passes a body the editor can hold', () => {
    const doc = docWithBody((fragment) => fragment.insert(0, [paragraph('abc')]))
    expect(writerFault(doc)).toBeNull()
  })

  it('passes an empty document', () => {
    expect(writerFault(new yjs.Doc())).toBeNull()
  })

  it('refuses a table cell straight in the body', () => {
    function cellInBody(fragment: yjs.XmlFragment) {
      const cell = new yjs.XmlElement('tableCell')
      cell.insert(0, [paragraph('z')])
      fragment.insert(0, [paragraph('abc'), cell])
    }

    const doc = docWithBody(cellInBody)
    expect(writerFault(doc)).toBe('schema: cannot place tableCell')
  })

  it('refuses text straight in the body', () => {
    const doc = docWithBody((fragment) => fragment.insert(0, [new yjs.XmlText('loose')]))
    expect(writerFault(doc)).toBe('schema: cannot place text')
  })

  it('names each kind it cannot place once', () => {
    function cellsInBody(fragment: yjs.XmlFragment) {
      const cells = ['tableCell', 'tableCell', 'tableHeader'].map(wrappedParagraph)
      fragment.insert(0, [paragraph('abc'), ...cells])
    }

    const doc = docWithBody(cellsInBody)
    expect(writerFault(doc)).toBe('schema: cannot place tableCell, tableHeader')
  })

  it('passes a body holding a tab', () => {
    function tabInBody(fragment: yjs.XmlFragment) {
      fragment.insert(0, [wrappedParagraph('tab')])
    }

    const doc = docWithBody(tabInBody)
    expect(writerFault(doc)).toBeNull()
  })

  it('passes a bold mention and a bold image', () => {
    function boldAtoms(fragment: yjs.XmlFragment) {
      const mention = new yjs.XmlElement<Record<string, string | object>>('mention')
      mention.setAttribute('id', 'ann')
      mention.setAttribute('bold', {})
      const image = new yjs.XmlElement<Record<string, string | object>>('image')
      image.setAttribute('src', '/files/x.png')
      image.setAttribute('bold', {})
      const block = new yjs.XmlElement('paragraph')
      block.insert(0, [new yjs.XmlText('a'), mention, image, new yjs.XmlText('b')] as (
        yjs.XmlElement | yjs.XmlText
      )[])
      fragment.insert(0, [block])
    }

    const doc = docWithBody(boldAtoms)
    expect(writerFault(doc)).toBeNull()
  })

  it('passes an empty row on a body with content', () => {
    const withContent = docWithBody((fragment) => fragment.insert(0, [paragraph('abc')]))
    const checkpoint = yjs.encodeStateAsUpdate(withContent)
    const empty = yjs.encodeStateAsUpdate(new yjs.Doc())
    expect(judge(checkpoint, [empty, empty], writerFault, () => {})).toEqual({ verdict: 'clean' })
  })

  it('writes nothing to the document, even over two texts it made side by side', () => {
    const doc = new yjs.Doc()
    const block = new yjs.XmlElement('paragraph')
    block.insert(0, [new yjs.XmlText('a'), new yjs.XmlText('b')])
    doc.getXmlFragment(BODY_FIELD).insert(0, [block])
    const before = yjs.encodeStateAsUpdate(doc)

    writerFault(doc)

    expect(yjs.encodeStateAsUpdate(doc)).toEqual(before)
  })
})
