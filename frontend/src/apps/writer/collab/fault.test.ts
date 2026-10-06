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
    expect(writerFault(body((f) => f.insert(0, [paragraph('abc')])))).toBeNull()
  })

  it('passes an empty document', () => {
    expect(writerFault(new Y.Doc())).toBeNull()
  })

  it('refuses a table cell straight in the body', () => {
    const doc = body((f) => {
      const cell = new Y.XmlElement('tableCell')
      cell.insert(0, [paragraph('z')])
      f.insert(0, [paragraph('abc'), cell])
    })
    expect(writerFault(doc)).toMatch(/^schema: RangeError: Invalid content for node doc/)
  })

  it('refuses text straight in the body', () => {
    expect(writerFault(body((f) => f.insert(0, [new Y.XmlText('loose')])))).toMatch(/^schema: /)
  })

  it('passes an empty row on a body with content', () => {
    const checkpoint = Y.encodeStateAsUpdate(body((f) => f.insert(0, [paragraph('abc')])))
    const empty = Y.encodeStateAsUpdate(new Y.Doc())
    expect(judge(checkpoint, [empty, empty], writerFault)).toEqual({ verdict: 'clean' })
  })
})
