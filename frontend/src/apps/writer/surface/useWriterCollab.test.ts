import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { openCollabRoom } from '@/platform/collab'

import { useWriterCollab } from './useWriterCollab'

const fakeRooms = vi.hoisted(() => {
  function makeRoom() {
    return {
      status: {
        canWrite: true,
        blockReason: null as string | null,
        stopReason: null as string | null,
        keptCopyCount: 0,
        hasCopyFailed: false,
        pauseReason: null as string | null,
        holdReason: null as string | null,
        isRestoring: false,
        hasNewerSchema: false,
        isReopenNeeded: false,
        saveState: 'clean',
        unsentCount: 0,
        othersUnsentCount: 0,
        isKeptOnDevice: true,
        isAtLimit: false,
      },
      listeners: [] as (() => void)[],
      onChange(listener: () => void) {
        this.listeners.push(listener)
        return () => {}
      },
      close: async () => {},
    }
  }

  return {
    room: makeRoom(),
    openCount: 0,
    makeRoom,
  }
})

vi.mock('@/platform/collab', async () => ({
  ...(await import('@suite/collab-client')),
  openCollabRoom: vi.fn(async ({ watch }: { watch: (room: object) => void }) => {
    fakeRooms.openCount++
    watch(fakeRooms.room)
    return { state: 'live', room: fakeRooms.room }
  }),
}))

vi.mock('@/apps/writer/collab/adapter', () => ({ writerAdapter: { app: 'writer' } }))

const watched = vi.hoisted(() => new Map<object, (removals: unknown[]) => void>())

vi.mock('@/apps/writer/collab/removals', () => ({
  watchRemovals: (room: object, report: (removals: unknown[]) => void) => {
    watched.set(room, report)
    return () => watched.delete(room)
  },
}))

const keepRemovedWork = vi.hoisted(() =>
  vi.fn(async (): Promise<'kept' | 'unkept' | null> => 'kept'),
)

vi.mock('@/apps/writer/recovery/copies', () => ({ keepRemovedWork }))

async function openCollab(retainRecovery = () => false, mayEdit = () => true) {
  const session = { nodeId: 'node-1', title: { value: 'Plan' } } as DocumentSession
  const collab = useWriterCollab(
    session,
    retainRecovery,
    mayEdit,
    () => {},
    () => false,
  )
  await collab.open()
  return collab
}

// One page load's room for the document, once a newer Writer edited it
async function newerSchemaBanner(load: typeof useWriterCollab, session: DocumentSession) {
  fakeRooms.room = fakeRooms.makeRoom()
  const collab = load(
    session,
    () => false,
    () => true,
    () => {},
    () => false,
  )
  await collab.open()
  becomes({ canWrite: false, hasNewerSchema: true })
  return collab.banner.value
}

type FakeStatus = typeof fakeRooms.room.status

function becomes(change: Partial<FakeStatus>) {
  becomesOn(fakeRooms.room, change)
}

function becomesOn(room: typeof fakeRooms.room, change: Partial<FakeStatus>) {
  room.status = { ...room.status, ...change }
  for (const listener of room.listeners) {
    listener()
  }
}

describe('writer collab editing state', () => {
  it('pauses editing, not access, while the room is stopped for a reason that clears', async () => {
    const collab = await openCollab()
    expect(collab.editingPaused.value).toBe(false)

    for (const blockReason of ['signed_out', 'locked', 'offline', 'stale_session', 'other_user']) {
      const canKeepWriting =
        blockReason === 'signed_out' || blockReason === 'locked' || blockReason === 'offline'
      becomes({
        blockReason,
        saveState: 'failed',
        unsentCount: 9,
        canWrite: canKeepWriting,
      })
      expect(collab.allowsEditing.value).toBe(false)
      expect(collab.editingPaused.value).toBe(true)
    }

    becomes({ blockReason: null, saveState: 'failed', canWrite: true })
    expect(collab.editingPaused.value).toBe(true)
  })

  it('tells why the room stopped saving', async () => {
    const collab = await openCollab()
    becomes({
      blockReason: null,
      stopReason: 'poison',
      saveState: 'failed',
      unsentCount: 1,
      canWrite: false,
    })
    expect(collab.banner.value?.text).toMatch(/can't hold a change made in this tab/)
  })

  it('says the unsent work was kept once the device holds its recovery copy', async () => {
    const collab = await openCollab()
    becomes({ stopReason: 'schema', saveState: 'failed', unsentCount: 1, canWrite: false })
    expect(collab.banner.value?.text).not.toMatch(/recovery copy/)

    becomes({ keptCopyCount: 1 })
    expect(collab.banner.value?.text).toBe(
      'This document was edited in a newer version of Writer, so saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })

  it('keeps a page copy when the device could not, and claims only what was written', async () => {
    const retainRecovery = vi.fn(() => false)
    const collab = await openCollab(retainRecovery)
    becomes({
      stopReason: 'seq',
      saveState: 'failed',
      unsentCount: 1,
      canWrite: false,
      keptCopyCount: 1,
    })
    becomes({ hasCopyFailed: true })
    expect(collab.banner.value?.text).toBe(
      "Saving stopped in this tab. Unsent changes couldn't be kept on this device, so keep this tab open.",
    )

    retainRecovery.mockReturnValue(true)
    becomes({ keptCopyCount: 1 })
    expect(collab.banner.value?.text).toMatch(/kept as a recovery copy/)
    becomes({ keptCopyCount: 0, hasCopyFailed: false })
  })

  it('leaves a lost right or a read-only room as view only', async () => {
    const collab = await openCollab()
    for (const blockReason of ['lost_edit', 'lost_read']) {
      becomes({ blockReason, saveState: 'failed', canWrite: false })
      expect(collab.editingPaused.value).toBe(false)
    }

    becomes({ blockReason: null, saveState: 'clean', canWrite: false })
    expect(collab.allowsEditing.value).toBe(false)
    expect(collab.editingPaused.value).toBe(false)
  })

  it('pauses editing while the server judges a change this tab could not apply', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({
      blockReason: null,
      saveState: 'unsaved',
      unsentCount: 1,
      canWrite: false,
      pauseReason: 'suspect',
    })
    expect([collab.allowsEditing.value, collab.editingPaused.value, collab.banner.value]).toEqual([
      false,
      true,
      null,
    ])
  })

  it('holds editing with a banner while an admin checks the document', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ canWrite: false, holdReason: 'change', unsentCount: 0 })
    expect([collab.allowsEditing.value, collab.editingPaused.value, collab.banner.value]).toEqual([
      false,
      true,
      { text: 'This document is read-only while an admin checks it.' },
    ])
  })

  it('holds editing with a banner while a version is restored', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ canWrite: false, isRestoring: true })
    const whileRestoring = [
      collab.allowsEditing.value,
      collab.editingPaused.value,
      collab.banner.value,
    ]
    becomes({ canWrite: true, isRestoring: false })

    expect(whileRestoring).toEqual([
      false,
      true,
      {
        text: 'Someone is restoring a version of this document. You can edit again once it is done.',
      },
    ])
    expect([collab.allowsEditing.value, collab.banner.value]).toEqual([true, null])
  })

  it('makes the document read-only with a banner once a newer Writer edited it', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ canWrite: false, hasNewerSchema: true })
    expect([collab.allowsEditing.value, collab.editingPaused.value, collab.banner.value]).toEqual([
      false,
      false,
      { text: 'This document was edited in a newer version of Writer. Reload to edit it.' },
    ])
  })

  it('tells a reader of a document a newer Writer edited to reload to see it', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(undefined, () => false)
    becomes({ canWrite: false, hasNewerSchema: true })
    expect(collab.banner.value).toEqual({
      text: 'This document was edited in a newer version of Writer. Reload to see its latest changes.',
    })
  })

  it('says a reload will not help once the banner is back right after one', async () => {
    const session = { nodeId: 'node-reloaded' } as DocumentSession
    const firstLoad = await newerSchemaBanner(useWriterCollab, session)
    vi.resetModules()
    const reloaded = await import('./useWriterCollab')
    const secondLoad = await newerSchemaBanner(reloaded.useWriterCollab, session)

    expect([firstLoad, secondLoad]).toEqual([
      { text: 'This document was edited in a newer version of Writer. Reload to edit it.' },
      {
        text: 'This document needs a newer version of Writer than this site has. Try again in a few minutes, or ask your admin.',
      },
    ])
  })

  it('keeps asking for a reload when the document opens again without one', async () => {
    const session = { nodeId: 'node-reopened' } as DocumentSession
    await newerSchemaBanner(useWriterCollab, session)
    const reopened = await newerSchemaBanner(useWriterCollab, session)

    expect(reopened).toEqual({
      text: 'This document was edited in a newer version of Writer. Reload to edit it.',
    })
  })

  it('keeps asking for a reload where the browser blocks this tab’s storage', async () => {
    const session = { nodeId: 'node-blocked' } as DocumentSession
    const blocked = vi.spyOn(globalThis, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    await newerSchemaBanner(useWriterCollab, session)
    vi.resetModules()
    const reloaded = await import('./useWriterCollab')
    const secondLoad = await newerSchemaBanner(reloaded.useWriterCollab, session)
    blocked.mockRestore()

    expect(secondLoad).toEqual({
      text: 'This document was edited in a newer version of Writer. Reload to edit it.',
    })
  })

  it('tells a writer their changes wait on a refusing network, and not on a busy one', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ saveState: 'unsaved', unsentCount: 1, pauseReason: 'compacting' })
    const busy = collab.banner.value
    becomes({ pauseReason: 'upload_refused' })
    expect([busy, collab.banner.value?.text]).toEqual([
      null,
      "Your network is refusing uploads, so your latest changes aren't saved. They're kept on this device.",
    ])
  })

  it('keeps editing open on a document at its size limit, and says deleting frees space', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ isAtLimit: true })
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

    oldRoom.status = { ...oldRoom.status, isReopenNeeded: true }
    for (const listener of oldRoom.listeners) {
      listener()
    }

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

    oldRoom.status = {
      ...oldRoom.status,
      isReopenNeeded: true,
      unsentCount: 2,
      isKeptOnDevice: false,
    }
    for (const listener of oldRoom.listeners) {
      listener()
    }

    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect(order).toEqual(['kept', 'closed'])
  })

  it.each([
    { name: 'without a device store', where: { isKeptOnDevice: false } },
    { name: 'after the device write failed', where: { isKeptOnDevice: true, hasCopyFailed: true } },
  ])(
    '$name and without a kept copy, leaves the unsent work on screen until it is sent',
    async ({ where }) => {
      fakeRooms.room = fakeRooms.makeRoom()
      const collab = await openCollab(() => false)
      const oldRoom = fakeRooms.room
      const closeSpy = vi.spyOn(oldRoom, 'close')
      fakeRooms.room = fakeRooms.makeRoom()
      const opensBefore = fakeRooms.openCount

      becomesOn(oldRoom, { isReopenNeeded: true, unsentCount: 2, ...where })
      await nextTick()
      expect([collab.mode.value, collab.room.value, closeSpy.mock.calls.length]).toEqual([
        'live',
        oldRoom,
        0,
      ])

      becomesOn(oldRoom, { unsentCount: 0 })
      await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
      expect(fakeRooms.openCount - opensBefore).toBe(1)
    },
  )

  it('still says the last edits were set aside once the room is rebuilt', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => true)
    const oldRoom = fakeRooms.room
    fakeRooms.room = fakeRooms.makeRoom()

    becomesOn(oldRoom, {
      isReopenNeeded: false,
      stopReason: 'client_closed',
      saveState: 'failed',
      unsentCount: 2,
    })
    expect(collab.banner.value).not.toBeNull()
    becomesOn(oldRoom, { isReopenNeeded: true })

    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect(collab.banner.value?.text).toBe(
      "Your last edits couldn't be saved here and were kept as a recovery copy.",
    )
  })

  it('says a restore set the edits aside once the room is rebuilt after one', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => true)
    const oldRoom = fakeRooms.room
    fakeRooms.room = fakeRooms.makeRoom()

    becomesOn(oldRoom, {
      stopReason: 'restored',
      saveState: 'failed',
      unsentCount: 1,
      isReopenNeeded: true,
    })

    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect(collab.banner.value?.text).toBe(
      'A version of this document was restored. Your edits from before it were kept as a recovery copy.',
    )
  })

  it("keeps a later room's unsent work on screen when this time no copy could be kept", async () => {
    let keepsLeft = 1
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => keepsLeft-- > 0)
    const first = fakeRooms.room
    fakeRooms.room = fakeRooms.makeRoom()
    const second = fakeRooms.room
    becomesOn(first, { isReopenNeeded: true, unsentCount: 2, isKeptOnDevice: false })
    await vi.waitFor(() => expect(collab.room.value).toBe(second))
    fakeRooms.room = fakeRooms.makeRoom()

    becomesOn(second, { isReopenNeeded: true, unsentCount: 1, isKeptOnDevice: false })
    await nextTick()

    expect(collab.room.value).toBe(second)
  })

  it('stops saying edits were set aside after a later rebuild sets nothing aside', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => true)
    const first = fakeRooms.room
    fakeRooms.room = fakeRooms.makeRoom()
    const second = fakeRooms.room
    becomesOn(first, { stopReason: 'client_closed', saveState: 'failed', unsentCount: 2 })
    becomesOn(first, { isReopenNeeded: true })
    await vi.waitFor(() => expect(collab.room.value).toBe(second))
    fakeRooms.room = fakeRooms.makeRoom()
    const third = fakeRooms.room

    becomesOn(second, { isReopenNeeded: true })
    await vi.waitFor(() => expect(collab.room.value).toBe(third))

    expect(collab.banner.value).toBeNull()
  })

  it('after a full document refuses a change, the rebuilt room says where it went and that deleting frees space', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab(() => true)
    const first = fakeRooms.room
    fakeRooms.room = fakeRooms.makeRoom()
    fakeRooms.room.status = { ...fakeRooms.room.status, isAtLimit: true }
    const second = fakeRooms.room
    becomesOn(first, { stopReason: 'document_full', saveState: 'failed', unsentCount: 1 })
    becomesOn(first, { isReopenNeeded: true })
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

    becomesOn(oldRoom, { isReopenNeeded: true, unsentCount: 2, isKeptOnDevice: true })

    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect(collab.banner.value).toBeNull()
  })

  it('watches only the live room for lost text, from open until close', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    watched.clear()
    const collab = await openCollab()
    const oldRoom = fakeRooms.room
    expect([watched.size, watched.has(oldRoom)]).toEqual([1, true])
    fakeRooms.room = fakeRooms.makeRoom()

    becomesOn(oldRoom, { isReopenNeeded: true })

    await vi.waitFor(() => expect(collab.room.value).toBe(fakeRooms.room))
    expect([watched.size, watched.has(fakeRooms.room)]).toEqual([1, true])
    collab.close()
    expect(watched.size).toBe(0)
  })

  it.each([
    {
      name: 'fails',
      opened: () => Promise.reject(new Error('down')),
      isClosing: false,
      mode: 'failed',
    },
    {
      name: 'opens no live room',
      opened: async () => ({ state: 'disabled' as const }),
      isClosing: false,
      mode: 'readonly',
    },
    {
      name: 'ends after the page closed',
      opened: async () => ({ state: 'disabled' as const }),
      isClosing: true,
      mode: 'opening',
    },
  ] as const)('stops watching a room whose open $name', async ({ opened, isClosing, mode }) => {
    fakeRooms.room = fakeRooms.makeRoom()
    watched.clear()
    vi.mocked(openCollabRoom).mockImplementationOnce(async ({ watch }) => {
      watch?.(fakeRooms.room as never)
      return opened()
    })
    const session = { nodeId: 'node-1', title: { value: 'Plan' } } as DocumentSession
    const collab = useWriterCollab(
      session,
      () => false,
      () => true,
      () => {},
      () => false,
    )

    const opening = collab.open()
    if (isClosing) {
      collab.close()
    }

    await opening

    expect([collab.mode.value, watched.size]).toEqual([mode, 0])
  })

  it('opens an old document the converter has not reached read-only, with no live room', async () => {
    vi.mocked(openCollabRoom).mockImplementationOnce(async () => ({
      state: 'unconverted' as const,
    }))

    const collab = await openCollab()

    expect([collab.mode.value, collab.room.value, collab.isLive.value]).toEqual([
      'unconverted',
      null,
      false,
    ])
  })

  it("keeps the text someone else's edit removed as a recovery copy, and says so", async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    const removals = [{ kind: 'node', name: 'image', attrs: {} }]
    keepRemovedWork.mockResolvedValueOnce('kept')

    watched.get(fakeRooms.room)!(removals)

    await vi.waitFor(() => expect(collab.copiesKept.value).toBe(1))
    expect(keepRemovedWork).toHaveBeenLastCalledWith('node-1', 'Plan', removals)
    expect(collab.banner.value?.text).toBe(
      "Someone else's edit removed text you typed. It was kept as a recovery copy.",
    )
  })

  it("says when this device couldn't keep the text someone else's edit removed", async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    keepRemovedWork.mockResolvedValueOnce('unkept')

    watched.get(fakeRooms.room)!([{ kind: 'node', name: 'image', attrs: {} }])

    await vi.waitFor(() => expect(collab.banner.value).not.toBeNull())
    expect(collab.banner.value?.text).toBe(
      "Someone else's edit removed text you typed, and it couldn't be kept on this device.",
    )
    expect(collab.copiesKept.value).toBe(0)
  })

  it('says nothing of a removal whose copy is kept already', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    keepRemovedWork.mockResolvedValueOnce(null)
    const callsBefore = keepRemovedWork.mock.calls.length

    watched.get(fakeRooms.room)!([{ kind: 'node', name: 'image', attrs: {} }])

    await vi.waitFor(() => expect(keepRemovedWork.mock.calls.length).toBe(callsBefore + 1))
    await Promise.resolve()
    expect([collab.banner.value, collab.copiesKept.value]).toEqual([null, 0])
  })

  it("still says text couldn't be kept once a later removal's copy is kept", async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    const report = watched.get(fakeRooms.room)!
    keepRemovedWork.mockResolvedValueOnce('unkept').mockResolvedValueOnce('kept')

    report([{ kind: 'node', name: 'image', attrs: {} }])
    await vi.waitFor(() => expect(collab.banner.value).not.toBeNull())
    report([{ kind: 'node', name: 'image', attrs: {} }])

    await vi.waitFor(() => expect(collab.copiesKept.value).toBe(1))
    expect(collab.banner.value?.text).toBe(
      "Someone else's edit removed text you typed, and it couldn't be kept on this device.",
    )
  })

  it('counts the unsent work other tabs of the document hold on this device', async () => {
    fakeRooms.room = fakeRooms.makeRoom()
    const collab = await openCollab()
    becomes({ saveState: 'unsaved', unsentCount: 1, othersUnsentCount: 2 })
    expect([collab.unsent.value, collab.saveState.value]).toEqual([3, 'unsaved'])
  })
})
