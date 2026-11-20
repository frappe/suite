import { afterEach, describe, expect, it, vi } from 'vitest'

import { Hub, watchRooms } from './hub'
import { fakeSocket } from './test-support'
import type { LiveSocket } from './types'

function memberWith(keys: { current: string[] }) {
  return {
    currentKeys: () => keys.current,
    connected: () => {},
    dropped: () => {},
    answered: () => {},
  }
}

function roomKeys(count: number) {
  return Array.from({ length: count }, (_, index) => `sc:room-${index}`)
}

describe('Hub', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns once each time the room count goes over the cap', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const socket: LiveSocket = { connected: true, on: () => {}, off: () => {}, emit: () => {} }
    const hub = Hub.forSocket(socket)
    const keys = { current: roomKeys(9) }
    hub.members.add(memberWith(keys))

    hub.sendRoomSet()
    keys.current = roomKeys(10)
    hub.sendRoomSet()
    expect(warn).toHaveBeenCalledTimes(1)

    keys.current = roomKeys(3)
    hub.sendRoomSet()
    keys.current = roomKeys(9)
    hub.sendRoomSet()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('joins the rooms it watches, hears their event, and leaves them when stopped', () => {
    const socket = fakeSocket({ answers: true })
    const told: unknown[] = []
    const watching = watchRooms(socket, ['sc:a', 'sc:b'], 'suite_collab_converted', (message) =>
      told.push(message),
    )
    expect([...socket.joined]).toEqual(['sc:a', 'sc:b'])

    socket.hear('suite_collab_converted', { state: 'converted' })
    watching.setKeys(['sc:c'])
    socket.drop()
    socket.back()
    expect([told, [...socket.joined]]).toEqual([[{ state: 'converted' }], ['sc:c']])

    watching.stop()
    socket.hear('suite_collab_converted', { state: 'refused' })
    expect([told, [...socket.joined]]).toEqual([[{ state: 'converted' }], []])
  })
})
