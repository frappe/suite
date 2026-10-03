import { describe, expect, it } from 'vitest'

import { useCollaborationUsers } from './useCollaborationUsers'

type AwarenessState = {
  user?: {
    id: string
    name: string
    avatar?: string
    color: string
  }
}

class FakeAwareness {
  clientID = 1
  states = new Map<number, AwarenessState>()
  listeners = new Set<() => void>()

  getStates() {
    return this.states
  }

  on(event: string, listener: () => void) {
    if (event === 'update') this.listeners.add(listener)
  }

  off(event: string, listener: () => void) {
    if (event === 'update') this.listeners.delete(listener)
  }

  emitUpdate() {
    for (const listener of this.listeners) listener()
  }
}

const user = (id: string): AwarenessState => ({
  user: {
    id,
    name: id,
    color: '#000000',
  },
})

describe('useCollaborationUsers', () => {
  it('lists the other people already present when the document loads', () => {
    const awareness = new FakeAwareness()
    awareness.states.set(1, user('owner@example.com'))
    awareness.states.set(2, user('peer@example.com'))

    const { peers } = useCollaborationUsers(awareness)

    expect(peers.value.map(({ id }) => id)).toEqual(['peer@example.com'])
  })

  it('is empty when this connection is alone', () => {
    const awareness = new FakeAwareness()
    awareness.states.set(1, user('owner@example.com'))

    const { peers } = useCollaborationUsers(awareness)

    expect(peers.value).toEqual([])
  })

  it('lists a person connected from several tabs once', () => {
    const awareness = new FakeAwareness()
    awareness.states.set(1, user('owner@example.com'))
    awareness.states.set(2, user('peer@example.com'))
    awareness.states.set(3, user('peer@example.com'))

    const { peers } = useCollaborationUsers(awareness)

    expect(peers.value.map(({ id }) => id)).toEqual(['peer@example.com'])
  })

  it('reacts to joins and leaves and unsubscribes on cleanup', () => {
    const awareness = new FakeAwareness()
    awareness.states.set(1, user('owner@example.com'))
    const { peers, cleanup } = useCollaborationUsers(awareness)

    awareness.states.set(2, user('peer@example.com'))
    awareness.emitUpdate()
    expect(peers.value.map(({ id }) => id)).toEqual(['peer@example.com'])

    awareness.states.delete(2)
    awareness.emitUpdate()
    expect(peers.value).toEqual([])

    cleanup()
    expect(awareness.listeners.size).toBe(0)
  })
})
