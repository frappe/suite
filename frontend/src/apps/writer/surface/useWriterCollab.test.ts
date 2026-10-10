import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { DocumentSession } from '@/apps/drive'

import { useWriterCollab } from './useWriterCollab'

const fakeRooms = vi.hoisted(() => {
  const makeRoom = () => ({
    canWrite: true,
    blocked: null as string | null,
    stopped: null as string | null,
    paused: null as string | null,
    held: null as string | null,
    newerSchema: false,
    needsRebuild: false,
    saveState: 'clean',
    unsent: 0,
    onDevice: true,
    atLimit: false,
    listeners: [] as (() => void)[],
    onChange(listener: () => void) {
      this.listeners.push(listener)
      return () => {}
    },
    close: async () => {},
  })

  return {
    room: makeRoom(),
    openCount: 0,
    makeRoom,
  }
})

vi.mock('@/apps/writer/collab', () => ({
  openWriterRoom: async () => {
    fakeRooms.openCount++
    return { state: 'live', room: fakeRooms.room }
  },
}))

async function openCollab(retainRecovery = () => false, mayEdit = () => true) {
  const session = { nodeId: 'node-1' } as DocumentSession
  const collab = useWriterCollab(session, retainRecovery, mayEdit)
  await collab.open()
  return collab
}

function becomes(change: Partial<typeof fakeRooms.room>) {
  becomesOn(fakeRooms.room, change)
}

function becomesOn(room: typeof fakeRooms.room, change: Partial<typeof fakeRooms.room>) {
  Object.assign(room, change)
  for (const listener of room.listeners) {
    listener()
  }
}

describe('writer collab editing state', () => {
  it('pauses editing, not access, while the room is stopped for a reason that clears', async () => {
    const collab = await openCollab()
    expect(collab.editingPaused.value).toBe(false)

    for (const blocked of ['signed_out', 'locked', 'offline', 'stale_session', 'other_user']) {
      const keepsWriteRight =
        blocked === 'signed_out' || blocked === 'locked' || blocked === 'offline'
      becomes({
        blocked,
        saveState: 'failed',
        unsent: 9,
        canWrite: keepsWriteRight,
      })
      expect(collab.allowsEditing.value).toBe(false)
      expect(collab.editingPaused.value).toBe(true)
    }

    becomes({ blocked: null, saveState: 'failed', canWrite: true })
    expect(collab.editingPaused.value).toBe(true)
  })

  it('tells why the room stopped saving', async () => {
    const collab = await openCollab()
    becomes({ blocked: null, stopped: 'poison', saveState: 'failed', unsent: 1, canWrite: false })
    expect(collab.banner.value?.text).toMatch(/can't hold a change made in this tab/)
  })

  it('leaves a lost right or a read-only room as view only', async () => {
    const collab = await openCollab()
    for (const blocked of ['lost_edit', 'lost_read']) {
      becomes({ blocked, saveState: 'failed', canWrite: false })
      expect(collab.editingPaused.value).toBe(false)
    }
    becomes({ blocked: null, saveState: 'clean', canWrite: false })
    expect(collab.allowsEditing.value).toBe(false)
    expect(collab.editingPaused.value).toBe(false)
  })

  it('pauses editing while the server judges a change this tab could not apply', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ blocked: null, saveState: 'unsaved', unsent: 1, canWrite: false, paused: 'suspect' })
    expect([collab.allowsEditing.value, collab.editingPaused.value, collab.banner.value]).toEqual([
      false,
      true,
      null,
    ])
  })

  it('holds editing with a banner while an admin reviews the document', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ canWrite: false, held: 'change', unsent: 0 })
    expect([collab.allowsEditing.value, collab.editingPaused.value, collab.banner.value]).toEqual([
      false,
      true,
      { text: 'This document is read-only while an admin reviews a change to it.' },
    ])
  })

  it('makes the document read-only with a banner once a newer Writer edited it', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ canWrite: false, newerSchema: true })
    expect([collab.allowsEditing.value, collab.editingPaused.value, collab.banner.value]).toEqual([
      false,
      false,
      { text: 'This document was edited in a newer version of Writer. Reload to edit it.' },
    ])
  })

  it('tells a reader of a document a newer Writer edited to reload to see it', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(undefined, () => false)
    becomes({ canWrite: false, newerSchema: true })
    expect(collab.banner.value).toEqual({
      text: 'This document was edited in a newer version of Writer. Reload to see its latest changes.',
    })
  })

  it('tells a writer their changes wait on a refusing network, and not on a busy one', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ saveState: 'unsaved', unsent: 1, paused: 'compacting' })
    const busy = collab.banner.value
    becomes({ paused: 'upload_refused' })
    expect([busy, collab.banner.value?.text]).toEqual([
      null,
      "Your network is refusing uploads, so your latest changes aren't saved. They're kept on this device.",
    ])
  })

  it('keeps editing open on a document at its size limit, and says deleting frees space', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ atLimit: true })
    expect([collab.allowsEditing.value, collab.banner.value?.text]).toEqual([
      true,
      'This document is at its size limit. Delete content to free space.',
    ])
  })
})

describe('writer collab rebuild', () => {
  it('opens the document again when the room may hold a quarantined change', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    const oldRoom = fakeRooms.room
    const closeSpy = vi.spyOn(oldRoom, 'close')
    fakeRooms.room = fakeRooms.makeRoom()
    const opensBefore = fakeRooms.openCount

    Object.assign(oldRoom, { needsRebuild: true })
    oldRoom.listeners.forEach((listener) => listener())

    expect([collab.mode.value, collab.room.value]).toEqual(['opening', null])
    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect([
      collab.mode.value,
      closeSpy.mock.calls.length,
      fakeRooms.openCount - opensBefore,
    ]).toEqual(['live', 1, 1])
  })

  it('without a device copy, keeps unsent work before the old room goes', async () => {
    const order: string[] = []
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => (order.push('kept'), true))
    const oldRoom = fakeRooms.room
    oldRoom.close = async () => void order.push('closed')
    fakeRooms.room = fakeRooms.makeRoom()

    Object.assign(oldRoom, { needsRebuild: true, unsent: 2, onDevice: false })
    oldRoom.listeners.forEach((listener) => listener())

    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect(order).toEqual(['kept', 'closed'])
  })

  it('without a device copy or a kept copy, leaves the unsent work on screen until it is sent', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => false)
    const oldRoom = fakeRooms.room
    const closeSpy = vi.spyOn(oldRoom, 'close')
    fakeRooms.room = fakeRooms.makeRoom()
    const opensBefore = fakeRooms.openCount

    becomesOn(oldRoom, { needsRebuild: true, unsent: 2, onDevice: false })
    await nextTick()
    expect([collab.mode.value, collab.room.value, closeSpy.mock.calls.length]).toEqual([
      'live',
      oldRoom,
      0,
    ])

    becomesOn(oldRoom, { unsent: 0 })
    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect(fakeRooms.openCount - opensBefore).toBe(1)
  })

  it('still says the last edits were set aside once the room is rebuilt', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => true)
    const oldRoom = fakeRooms.room
    fakeRooms.room = fakeRooms.makeRoom()

    becomesOn(oldRoom, {
      needsRebuild: false,
      stopped: 'client_closed',
      saveState: 'failed',
      unsent: 2,
    })
    expect(collab.banner.value).not.toBeNull()
    becomesOn(oldRoom, { needsRebuild: true })

    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect(collab.banner.value?.text).toBe(
      "Your last edits couldn't be saved here and were kept as a recovery copy.",
    )
  })

  it("keeps a later room's unsent work on screen when this time no copy could be kept", async () => {
    let keepsLeft = 1
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => keepsLeft-- > 0)
    const first = fakeRooms.room
    fakeRooms.room = fakeRooms.makeRoom()
    const second = fakeRooms.room
    becomesOn(first, { needsRebuild: true, unsent: 2, onDevice: false })
    await vi.waitFor(() => expect(collab.room.value).toBe(second))
    fakeRooms.room = fakeRooms.makeRoom()

    becomesOn(second, { needsRebuild: true, unsent: 1, onDevice: false })
    await nextTick()

    expect(collab.room.value).toBe(second)
  })

  it('stops saying edits were set aside after a later rebuild sets nothing aside', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => true)
    const first = fakeRooms.room
    fakeRooms.room = fakeRooms.makeRoom()
    const second = fakeRooms.room
    becomesOn(first, { stopped: 'client_closed', saveState: 'failed', unsent: 2 })
    becomesOn(first, { needsRebuild: true })
    await vi.waitFor(() => expect(collab.room.value).toBe(second))
    fakeRooms.room = fakeRooms.makeRoom()
    const third = fakeRooms.room

    becomesOn(second, { needsRebuild: true })
    await vi.waitFor(() => expect(collab.room.value).toBe(third))

    expect(collab.banner.value).toBeNull()
  })

  it('after a full document refuses a change, the rebuilt room says where it went and that deleting frees space', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => true)
    const first = fakeRooms.room
    fakeRooms.room = { ...fakeRooms.makeRoom(), atLimit: true }
    const second = fakeRooms.room
    becomesOn(first, { stopped: 'document_full', saveState: 'failed', unsent: 1 })
    becomesOn(first, { needsRebuild: true })
    await vi.waitFor(() => expect(collab.room.value).toBe(second))

    expect([collab.allowsEditing.value, collab.banner.value?.text]).toEqual([
      true,
      'This document is at its size limit. Your latest changes went to a recovery copy. Delete content to free space.',
    ])
  })

  it('says nothing was set aside when the rebuilt room takes the unsent work over', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    const oldRoom = fakeRooms.room
    fakeRooms.room = fakeRooms.makeRoom()

    becomesOn(oldRoom, { needsRebuild: true, unsent: 2, onDevice: true })

    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect(collab.banner.value).toBeNull()
  })
})
