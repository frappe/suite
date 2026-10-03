import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as Y from 'yjs'

import { SERVER_ORIGIN, trackUnsaved } from './unsaved'

/** A body the editor binds to, with a sender to write into it. */
function openDocument() {
  const doc = new Y.Doc()
  const text = doc.getText('default')
  const unsaved = ref(false)
  const onChange = vi.fn()
  const tracking = trackUnsaved(doc, unsaved, onChange)
  const type = (words: string, origin: unknown = 'editor') =>
    doc.transact(() => text.insert(text.length, words), origin)
  return { doc, text, unsaved, onChange, tracking, type }
}

describe('the unsaved flag of a collaborative document', () => {
  it('stays clear while the stored body is loaded and bookkeeping is written', () => {
    const { doc, unsaved, onChange } = openDocument()
    const stored = new Y.Doc()
    stored.getText('default').insert(0, 'The stored body')

    Y.applyUpdate(doc, Y.encodeStateAsUpdate(stored), SERVER_ORIGIN)
    doc.transact(() => doc.getMap('users').set('1', 'ann@example.com'))

    expect(doc.getText('default').toString()).toBe('The stored body')
    expect(unsaved.value).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is set by a change from this editor or a peer and cleared by the save that follows', async () => {
    const { unsaved, onChange, tracking, type } = openDocument()

    type('Hello')
    expect(unsaved.value).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)

    await tracking.storeThrough(async () => {})
    expect(unsaved.value).toBe(false)

    type(' from a peer', { peer: true })
    expect(unsaved.value).toBe(true)
    await tracking.storeThrough(async () => {})
    expect(unsaved.value).toBe(false)
  })

  it('stays set when the body changes while a save is in flight, or the save fails', async () => {
    const { unsaved, tracking, type } = openDocument()
    type('Draft')

    let finish!: () => void
    const inFlight = tracking.storeThrough(() => new Promise<void>((resolve) => (finish = resolve)))
    type(' with more')
    finish()
    await inFlight
    expect(unsaved.value).toBe(true)

    await expect(tracking.storeThrough(() => Promise.reject(new Error('offline')))).rejects.toThrow(
      'offline',
    )
    expect(unsaved.value).toBe(true)

    await tracking.storeThrough(async () => {})
    expect(unsaved.value).toBe(false)
  })
})
