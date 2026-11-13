import { describe, expect, it } from 'vitest'
import * as yjs from 'yjs'

import { CollabOpenError } from './answers'
import { readSavedState } from './open'
import { frame, reply } from './test-support'

function textUpdate(text: string, base?: yjs.Doc) {
  const doc = base ?? new yjs.Doc()
  doc.getText('t').insert(doc.getText('t').length, text)
  return { doc, bytes: yjs.encodeStateAsUpdate(doc) }
}

describe('reading a saved document once', () => {
  it('gives the checkpoint with the rows after it, skipping an empty row', async () => {
    const { doc, bytes: checkpoint } = textUpdate('one')
    const { bytes: row } = textUpdate(' two', doc)
    const answer = frame(
      { state: 'live', proto: 1, lineage: 'x', base: 1 },
      [
        { rev: 2, bytes: new Uint8Array() },
        { rev: 3, bytes: row },
      ],
      checkpoint,
    )

    const saved = await readSavedState(async () => answer)

    expect(saved?.getText('t').toString()).toBe('one two')
  })

  it('answers null for a document that is not collaborative', async () => {
    const answer = frame({ state: 'unconverted', proto: 1 })

    await expect(readSavedState(async () => answer)).resolves.toBeNull()
  })

  it('refuses when the server does', async () => {
    const answer = reply(403, { collab: 'denied' })

    await expect(readSavedState(async () => answer)).rejects.toBeInstanceOf(CollabOpenError)
  })
})
