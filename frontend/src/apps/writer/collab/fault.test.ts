import { judge } from '@suite/collab-client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { FIELD } from '@/apps/writer/collab'
import { writerFault } from '@/apps/writer/collab/fault'

function paragraph(text: string) {
  const node = new Y.XmlElement('paragraph')
  node.insert(0, [new Y.XmlText(text)])
  return node
}

function body(build: (fragment: Y.XmlFragment) => void) {
  const doc = new Y.Doc()
  build(doc.getXmlFragment(FIELD))
  return doc
}

describe('writerFault', () => {
  it('passes a body the editor can hold', () => {
    const doc = body((f) => f.insert(0, [paragraph('abc')]))
    expect(writerFault(doc)).toBeNull()
  })

  it('passes an empty document', () => {
    expect(writerFault(new Y.Doc())).toBeNull()
  })

  it('refuses a table cell straight in the body', () => {
    const cellInBody = (f: Y.XmlFragment) => {
      const cell = new Y.XmlElement('tableCell')
      cell.insert(0, [paragraph('z')])
      f.insert(0, [paragraph('abc'), cell])
    }
    const doc = body(cellInBody)
    expect(writerFault(doc)).toMatch(/^schema: RangeError: Invalid content for node doc/)
  })

  it('refuses text straight in the body', () => {
    const doc = body((f) => f.insert(0, [new Y.XmlText('loose')]))
    expect(writerFault(doc)).toMatch(/^schema: /)
  })

  it('passes an empty row on a body with content', () => {
    const withContent = body((f) => f.insert(0, [paragraph('abc')]))
    const checkpoint = Y.encodeStateAsUpdate(withContent)
    const empty = Y.encodeStateAsUpdate(new Y.Doc())
    expect(judge(checkpoint, [empty, empty], writerFault)).toEqual({ verdict: 'clean' })
  })
})
