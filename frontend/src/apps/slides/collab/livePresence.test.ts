import { describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { Doc } from 'yjs'

import type { RoomPresence } from '@/platform/collab'

import { slidesAdapter } from './adapter'
import { selectionOf, sharedPresence } from './livePresence'

function presenceOn(awareness: Awareness): RoomPresence {
  return { awareness, peers: [], ownPid: 1, ownArrival: 0, onChange: () => () => {} }
}

function open() {
  const awareness = new Awareness(new Doc())
  const shared = sharedPresence(presenceOn(awareness))
  return { awareness, ...shared }
}

const ids = (total: number) => Array.from({ length: total }, (_, at) => `e${at}`)

describe('sharedPresence', () => {
  it('sends at most twenty elements and the full number selected', () => {
    const { awareness, publishSelection } = open()

    publishSelection(ids(34))

    const { cursor } = awareness.getLocalState()!
    expect(cursor.elements).toHaveLength(20)
    expect(cursor.count).toBe(34)
  })

  it('keeps the selection when the caret moves, and the caret when the selection changes', () => {
    const { awareness, publishSelection, textPresence } = open()

    publishSelection(['one'])
    textPresence.awareness.setLocalStateField('cursor', { anchor: 'a', head: 'b' })
    expect(awareness.getLocalState()!.cursor).toEqual({
      anchor: 'a',
      head: 'b',
      elements: ['one'],
      count: 1,
    })

    publishSelection(['two'])
    expect(awareness.getLocalState()!.cursor.anchor).toBe('a')
  })

  it('shows the caret code only a caret', () => {
    const { publishSelection, textPresence } = open()

    publishSelection(['one'])
    expect(textPresence.awareness.getLocalState()!.cursor).toBeNull()

    textPresence.awareness.setLocalStateField('cursor', { anchor: 'a', head: 'b' })
    expect(textPresence.awareness.getLocalState()!.cursor).toEqual({ anchor: 'a', head: 'b' })
  })

  it('sends nothing once there is no caret and no selection', () => {
    const { awareness, publishSelection } = open()

    publishSelection(['one'])
    publishSelection([])

    expect(awareness.getLocalState()!.cursor).toBeNull()
  })

  it('tells the caret code when a change arrives', () => {
    const { awareness, textPresence } = open()
    const heard = vi.fn()
    textPresence.awareness.on('change', heard)

    awareness.setLocalStateField('cursor', { anchor: 'a', head: 'b' })

    expect(heard).toHaveBeenCalled()
  })
})

describe('what a co-editor sends', () => {
  it('reads as no selection when it is malformed', () => {
    expect(selectionOf(null)).toBeNull()
    expect(selectionOf({ elements: 'one', count: 1 })).toBeNull()
    expect(selectionOf({ elements: ['one'] })).toBeNull()
  })

  it('drops anything in the list that is not an id', () => {
    expect(selectionOf({ elements: ['one', 7, null], count: 3 })?.elements).toEqual(['one'])
  })

  it('never passes on more than twenty elements', () => {
    const position = slidesAdapter.toPeerPosition({ elements: ids(500), count: 500 })

    expect(position).toMatchObject({ count: 500 })
    expect(position).toHaveProperty('elements.length', 20)
  })

  it('cannot claim fewer elements than it lists', () => {
    expect(slidesAdapter.toPeerPosition({ elements: ['a', 'b'], count: 0 })).toMatchObject({
      count: 2,
    })
  })
})
