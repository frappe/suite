import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { covers } from './covers'

function typing(...words: string[]) {
  const doc = new Y.Doc()
  const rows: Uint8Array[] = []
  doc.on('update', (bytes: Uint8Array) => rows.push(bytes))
  const text = doc.getText('t')
  for (const word of words) {
    text.insert(text.length, word)
  }

  return { doc, rows }
}

describe('covers', () => {
  it('holds rows already merged into the body', () => {
    const { doc, rows } = typing('a', 'b', 'c')
    expect(covers(Y.encodeStateAsUpdate(doc), rows)).toBe(true)
  })

  it('does not hold a row typed after the body', () => {
    const { doc, rows } = typing('a', 'b')
    const body = Y.encodeStateAsUpdate(doc)
    doc.getText('t').insert(0, 'z')
    expect(
      covers(body, [...rows, Y.encodeStateAsUpdate(doc, Y.encodeStateVectorFromUpdate(body))]),
    ).toBe(false)
  })

  it('does not hold a delete the body lacks', () => {
    const { doc, rows } = typing('abc')
    const body = Y.encodeStateAsUpdate(doc)
    const vector = Y.encodeStateVector(doc)
    doc.getText('t').delete(0, 1)
    expect(covers(body, [...rows, Y.encodeStateAsUpdate(doc, vector)])).toBe(false)
  })

  it('does not hold a row waiting on a change the body lacks', () => {
    const { rows } = typing('a', 'b', 'c')
    const body = Y.encodeStateAsUpdate(typing('x').doc)
    expect(covers(body, [rows[2]])).toBe(false)
  })

  it('does not hold a row that cannot be read', () => {
    const { doc } = typing('a')
    expect(covers(Y.encodeStateAsUpdate(doc), [new Uint8Array([255, 255, 255])])).toBe(false)
  })
})
