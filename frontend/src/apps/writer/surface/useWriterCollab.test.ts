import { describe, expect, it, vi } from 'vitest'

import type { DocumentSession } from '@/apps/drive'

import { useWriterCollab } from './useWriterCollab'

const fake = vi.hoisted(() => {
  const make = () => ({
    canWrite: true,
    blocked: null as string | null,
    stopped: null as string | null,
    paused: null,
    stale: false,
    saveState: 'clean',
    unsent: 0,
    onDevice: true,
    listeners: [] as (() => void)[],
    onChange(listener: () => void) {
      this.listeners.push(listener)
      return () => {}
    },
    close: async () => {},
  })
  return { room: make(), opens: 0, make }
})

vi.mock('@/apps/writer/collab', () => ({
  openWriterRoom: async () => {
    fake.opens++
    return { state: 'live', room: fake.room }
  },
}))

async function opened(retainRecovery = () => false) {
  const collab = useWriterCollab({ nodeId: 'node-1' } as DocumentSession, retainRecovery)
  await collab.open()
  return collab
}

function becomes(change: Partial<typeof fake.room>) {
  Object.assign(fake.room, change)
  for (const listener of fake.room.listeners) listener()
}

describe('writer collab editing state', () => {
  it('pauses editing, not access, while the room is stopped for a reason that clears', async () => {
    const collab = await opened()
    expect(collab.editingPaused.value).toBe(false)

    for (const blocked of ['signed_out', 'locked', 'offline', 'stale_session', 'other_user']) {
      becomes({
        blocked,
        saveState: 'failed',
        unsent: 9,
        canWrite: blocked === 'signed_out' || blocked === 'locked' || blocked === 'offline',
      })
      expect(collab.allowsEditing.value).toBe(false)
      expect(collab.editingPaused.value).toBe(true)
    }

    becomes({ blocked: null, saveState: 'failed', canWrite: true })
    expect(collab.editingPaused.value).toBe(true)
  })

  it('tells why the room stopped saving', async () => {
    const collab = await opened()
    becomes({ blocked: null, stopped: 'poison', saveState: 'failed', unsent: 1, canWrite: false })
    expect(collab.banner.value?.text).toMatch(/can't hold a change made in this tab/)
  })

  it('leaves a lost right or a read-only room as view only', async () => {
    const collab = await opened()
    for (const blocked of ['lost_edit', 'lost_read']) {
      becomes({ blocked, saveState: 'failed', canWrite: false })
      expect(collab.editingPaused.value).toBe(false)
    }
    becomes({ blocked: null, saveState: 'clean', canWrite: false })
    expect(collab.allowsEditing.value).toBe(false)
    expect(collab.editingPaused.value).toBe(false)
  })
})

describe('writer collab rebuild', () => {
  it('opens the document again when the room may hold a quarantined change', async () => {
    fake.room = fake.make()
    const collab = await opened()
    const old = fake.room
    const closed = vi.spyOn(old, 'close')
    fake.room = fake.make()
    const opens = fake.opens

    Object.assign(old, { stale: true })
    old.listeners.forEach((listener) => listener())

    expect([collab.mode.value, collab.room.value]).toEqual(['opening', null])
    await vi.waitFor(() => expect(collab.room.value).toBe(fake.room))
    expect([collab.mode.value, closed.mock.calls.length, fake.opens - opens]).toEqual([
      'live',
      1,
      1,
    ])
  })

  it('without a device copy, keeps unsent work before the old room goes', async () => {
    const order: string[] = []
    fake.room = fake.make()
    const collab = await opened(() => (order.push('kept'), true))
    const old = fake.room
    old.close = async () => void order.push('closed')
    fake.room = fake.make()

    Object.assign(old, { stale: true, unsent: 2, onDevice: false })
    old.listeners.forEach((listener) => listener())

    await vi.waitFor(() => expect(collab.room.value).toBe(fake.room))
    expect(order).toEqual(['kept', 'closed'])
  })
})
