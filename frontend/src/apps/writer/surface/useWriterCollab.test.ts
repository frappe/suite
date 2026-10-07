import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { DocumentSession } from '@/apps/drive'

import { useWriterCollab } from './useWriterCollab'

const fake = vi.hoisted(() => {
  const make = () => ({
    canWrite: true,
    blocked: null as string | null,
    stopped: null as string | null,
    paused: null as string | null,
    needsRebuild: false,
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
  becomesOn(fake.room, change)
}

function becomesOn(room: typeof fake.room, change: Partial<typeof fake.room>) {
  Object.assign(room, change)
  for (const listener of room.listeners) listener()
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

  it('pauses editing while the server judges a change this tab could not apply', async () => {
    fake.room = fake.make()
    const collab = await opened()
    becomes({ blocked: null, saveState: 'unsaved', unsent: 1, canWrite: false, paused: 'suspect' })
    expect([collab.allowsEditing.value, collab.editingPaused.value, collab.banner.value]).toEqual([
      false,
      true,
      null,
    ])
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

    Object.assign(old, { needsRebuild: true })
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

    Object.assign(old, { needsRebuild: true, unsent: 2, onDevice: false })
    old.listeners.forEach((listener) => listener())

    await vi.waitFor(() => expect(collab.room.value).toBe(fake.room))
    expect(order).toEqual(['kept', 'closed'])
  })

  it('without a device copy or a kept copy, leaves the unsent work on screen until it is sent', async () => {
    fake.room = fake.make()
    const collab = await opened(() => false)
    const old = fake.room
    const closed = vi.spyOn(old, 'close')
    fake.room = fake.make()
    const opens = fake.opens

    becomesOn(old, { needsRebuild: true, unsent: 2, onDevice: false })
    await nextTick()
    expect([collab.mode.value, collab.room.value, closed.mock.calls.length]).toEqual([
      'live',
      old,
      0,
    ])

    becomesOn(old, { unsent: 0 })
    await vi.waitFor(() => expect(collab.room.value).toBe(fake.room))
    expect(fake.opens - opens).toBe(1)
  })

  it('still says the last edits were set aside once the room is rebuilt', async () => {
    fake.room = fake.make()
    const collab = await opened(() => true)
    const old = fake.room
    fake.room = fake.make()

    becomesOn(old, {
      needsRebuild: false,
      stopped: 'client_closed',
      saveState: 'failed',
      unsent: 2,
    })
    expect(collab.banner.value).not.toBeNull()
    becomesOn(old, { needsRebuild: true })

    await vi.waitFor(() => expect(collab.room.value).toBe(fake.room))
    expect(collab.banner.value?.text).toBe(
      "Your last edits couldn't be saved here and were kept as a recovery copy.",
    )
  })

  it('says nothing was set aside when the rebuilt room takes the unsent work over', async () => {
    fake.room = fake.make()
    const collab = await opened()
    const old = fake.room
    fake.room = fake.make()

    becomesOn(old, { needsRebuild: true, unsent: 2, onDevice: true })

    await vi.waitFor(() => expect(collab.room.value).toBe(fake.room))
    expect(collab.banner.value).toBeNull()
  })
})
