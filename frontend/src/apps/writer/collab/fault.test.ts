import { judge } from '@suite/collab-client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab'
import { writerFault } from '@/apps/writer/collab/fault'

function paragraph(text: string) {
  const node = new Y.XmlElement('paragraph')
  node.insert(0, [new Y.XmlText(text)])
  return node
}

function wrappedParagraph(name: string) {
  const node = new Y.XmlElement(name)
  node.insert(0, [paragraph(name)])
  return node
}

function docWithBody(build: (fragment: Y.XmlFragment) => void) {
  const doc = new Y.Doc()
  build(doc.getXmlFragment(BODY_FIELD))
  return doc
}

describe('writerFault', () => {
  it('passes a body the editor can hold', () => {
    const doc = docWithBody((fragment) => fragment.insert(0, [paragraph('abc')]))
    expect(writerFault(doc)).toBeNull()
  })

  it('passes an empty document', () => {
    expect(writerFault(new Y.Doc())).toBeNull()
  })

  it('refuses a table cell straight in the body', () => {
    const cellInBody = (fragment: Y.XmlFragment) => {
      const cell = new Y.XmlElement('tableCell')
      cell.insert(0, [paragraph('z')])
      fragment.insert(0, [paragraph('abc'), cell])
    }
    const doc = docWithBody(cellInBody)
    expect(writerFault(doc)).toBe('schema: cannot place tableCell')
  })

  it('refuses text straight in the body', () => {
    const doc = docWithBody((fragment) => fragment.insert(0, [new Y.XmlText('loose')]))
    expect(writerFault(doc)).toBe('schema: cannot place text')
  })

  it('names each kind it cannot place once', () => {
    function cellsInBody(fragment: Y.XmlFragment) {
      const cells = ['tableCell', 'tableCell', 'tableHeader'].map(wrappedParagraph)
      fragment.insert(0, [paragraph('abc'), ...cells])
    }

    const doc = docWithBody(cellsInBody)
    expect(writerFault(doc)).toBe('schema: cannot place tableCell, tableHeader')
  })

  it('passes a body holding a tab', () => {
    function tabInBody(fragment: Y.XmlFragment) {
      fragment.insert(0, [wrappedParagraph('tab')])
    }

    const doc = docWithBody(tabInBody)
    expect(writerFault(doc)).toBeNull()
  })

  it('passes an empty row on a body with content', () => {
    const withContent = docWithBody((fragment) => fragment.insert(0, [paragraph('abc')]))
    const checkpoint = Y.encodeStateAsUpdate(withContent)
    const empty = Y.encodeStateAsUpdate(new Y.Doc())
    expect(judge(checkpoint, [empty, empty], writerFault)).toEqual({ verdict: 'clean' })
  })

  it('writes nothing to the document, even over two texts it made side by side', () => {
    const doc = new Y.Doc()
    const block = new Y.XmlElement('paragraph')
    block.insert(0, [new Y.XmlText('a'), new Y.XmlText('b')])
    doc.getXmlFragment(BODY_FIELD).insert(0, [block])
    const before = Y.encodeStateAsUpdate(doc)

    writerFault(doc)

    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })
})
