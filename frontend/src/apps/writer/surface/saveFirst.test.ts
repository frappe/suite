import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RoomStatus } from '@/platform/collab'

import { saveFirst } from './saveFirst'

// A room whose save state the test moves, telling its listeners as a room does
function fakeRoom(saveState: RoomStatus['saveState']) {
  const listeners = new Set<() => void>()
  const room = {
    status: {
      saveState,
      blockReason: null as 'offline' | 'signed_out' | null,
      pauseReason: null as string | null,
    },
    flush: vi.fn(() => Promise.resolve()),
    onChange(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    move(next: RoomStatus['saveState']) {
      room.status = { ...room.status, saveState: next }
      for (const listener of listeners) {
        listener()
      }
    },
  }
  return room
}

async function outcome(saving: Promise<void>) {
  try {
    await saving
    return 'saved'
  } catch (error) {
    return (error as Error).message
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('saving before a named version', () => {
  it('sends the edits and goes ahead once everything on the device is saved', async () => {
    const room = fakeRoom('unsaved')
    const saving = outcome(saveFirst(room, 1_000))

    room.move('saving')
    room.move('clean')

    expect([await saving, room.flush.mock.calls.length]).toEqual(['saved', 1])
  })

  it('goes ahead at once when nothing is unsaved', async () => {
    expect(await outcome(saveFirst(fakeRoom('clean'), 1_000))).toBe('saved')
  })

  it('stops with the reason as soon as saving is refused', async () => {
    vi.useFakeTimers()
    const room = fakeRoom('unsaved')
    const refused = expect(saveFirst(room, 1_000)).rejects.toThrow(
      'No version was taken: your changes could not be saved.',
    )

    room.move('failed')

    await refused
  })

  it.each([
    ['offline', "No version was taken: you're offline, so your changes aren't saved yet."],
    ['paused', 'No version was taken: saving is paused.'],
    ['slow', 'No version was taken: your changes are still saving. Try again in a moment.'],
  ])(
    'stops with the reason when %s edits are still unsaved after the wait',
    async (why, reason) => {
      vi.useFakeTimers()
      vi.stubGlobal('navigator', { onLine: why !== 'offline' })
      const room = fakeRoom('unsaved')
      room.status = { ...room.status, pauseReason: why === 'paused' ? 'busy' : null }
      const saving = outcome(saveFirst(room, 1_000))

      await vi.advanceTimersByTimeAsync(999)
      room.move('saving')
      await vi.advanceTimersByTimeAsync(1)

      expect(await saving).toBe(reason)
    },
  )
})
