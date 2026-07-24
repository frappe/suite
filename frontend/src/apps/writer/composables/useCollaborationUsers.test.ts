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
  it('exposes users already present when the document loads', () => {
    const awareness = new FakeAwareness()
    awareness.states.set(1, user('owner@example.com'))
    awareness.states.set(2, user('peer@example.com'))

    const { users } = useCollaborationUsers(awareness)

    expect(users.value.map(({ id }) => id)).toEqual([
      'owner@example.com',
      'peer@example.com',
    ])
  })

  it('reacts to joins and leaves and unsubscribes on cleanup', () => {
    const awareness = new FakeAwareness()
    awareness.states.set(1, user('owner@example.com'))
    const { users, cleanup } = useCollaborationUsers(awareness)

    awareness.states.set(2, user('peer@example.com'))
    awareness.emitUpdate()
    expect(users.value.map(({ id }) => id)).toEqual([
      'owner@example.com',
      'peer@example.com',
    ])

    awareness.states.delete(2)
    awareness.emitUpdate()
    expect(users.value.map(({ id }) => id)).toEqual(['owner@example.com'])

    cleanup()
    expect(awareness.listeners.size).toBe(0)
    expect(users.value).toEqual([])
  })
})
