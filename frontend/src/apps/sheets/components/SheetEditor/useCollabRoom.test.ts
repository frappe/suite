import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CollabSession } from '@/platform/collab'

import { openSheetRoom, type OpenSheetOptions } from '../../collab/room'
import { roots } from '../../collab/schema'
import { fakeServer } from '../../collab/test-room'
import { cmd, makeStores, newClient, openTab } from '../../collab/test-tabs'
import { useCollabRoom } from './useCollabRoom'

const toast = vi.hoisted(() => ({ info: vi.fn() }))
vi.mock('frappe-ui', () => ({ toast }))
vi.mock('@/api', () => ({ api: {}, client: {} }))
vi.mock('@/platform/session', () => ({
  useSession: () => ({ user: { value: { id: 'me@x' } } }),
}))

// Real IronCalc workbooks, several round trips each.
const TIMEOUT = 30_000

const session = { nodeId: 'n1' } as unknown as CollabSession

afterEach(() => {
  toast.info.mockClear()
})

async function seeded() {
  const t = await openTab('seed')
  t.glue.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 1, col: 1, input: 'start' }))
  await t.glue.commit()
  return fakeServer(t.doc)
}

function editor(server: ReturnType<typeof fakeServer>, extra = {}) {
  const onRemote = vi.fn()
  const onReopen = vi.fn()
  const collab = useCollabRoom({
    session,
    getStores: makeStores,
    getSelection: () => ({ sheet: 'Sheet1', r0: 0, c0: 0, r1: 0, c1: 0 }),
    onRemote,
    onReopen,
    open: (o: OpenSheetOptions) => openSheetRoom({ ...o, open: server.open }),
    ...extra,
  })
  return { collab, onRemote, onReopen }
}

// What the server's copy of the sheet holds, as the inputs of every cell.
const sent = (server: ReturnType<typeof fakeServer>, i = 0) =>
  [...roots(server.rooms[i]!.doc).inputs.values()].sort()

describe('useCollabRoom', { timeout: TIMEOUT }, () => {
  it('answers disabled when Sheets collaboration is off, and stays off', async () => {
    const { collab } = editor(fakeServer(), {
      open: async () => ({ state: 'disabled' as const }),
    })
    expect(await collab.open(await newClient())).toBe('disabled')
    expect(collab.isLive.value).toBe(false)
    expect(collab.banner.value).toBeNull()
  })

  it('sends each action as one commit, which is one undo step', async () => {
    const server = await seeded()
    const { collab } = editor(server)
    expect(await collab.open(await newClient())).toBe('live')
    collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 2, col: 1, input: 'a' }))
    collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 3, col: 1, input: 'b' }))
    await collab.commit()
    expect(sent(server)).toEqual(['a', 'b', 'start'])
    expect(collab.canUndo.value).toBe(true)
    await collab.undo()
    expect(sent(server)).toEqual(['start'])
    expect(collab.canUndo.value).toBe(false)
    expect(collab.canRedo.value).toBe(true)
  })

  it('commits a command whose action never said it ended, after its last command', async () => {
    const server = await seeded()
    const { collab } = editor(server, { commitSoonMs: 50 })
    await collab.open(await newClient())
    collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 5, col: 2, input: 'loose' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(sent(server)).not.toContain('loose')
    await vi.waitFor(() => expect(sent(server)).toContain('loose'))
  })

  it('makes one commit of every end-of-action mark in one task', async () => {
    const server = await seeded()
    const { collab } = editor(server)
    await collab.open(await newClient())
    collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 7, col: 1, input: 'once' }))
    const marks = [collab.commit(), collab.commit(), collab.commit()]
    expect(new Set(marks).size).toBe(1)
    await marks[0]
    expect(sent(server)).toContain('once')
    await collab.undo()
    expect(sent(server)).toEqual(['start'])
  })

  it('never commits pivot output on its own', async () => {
    const server = await seeded()
    const { collab } = editor(server, { commitSoonMs: 10 })
    await collab.open(await newClient())
    collab.localOnly(() =>
      collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 9, col: 1, input: 'pivot' })),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(server.rooms[0]!.outbox).toEqual([])
    expect(collab.canUndo.value).toBe(false)
  })

  it('sends an action still open before the room closes or flushes', async () => {
    const server = await seeded()
    const { collab } = editor(server)
    await collab.open(await newClient())
    collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 3, col: 3, input: 'flushed' }))
    await collab.flush()
    expect(sent(server)).toContain('flushed')
    expect(server.rooms[0]!.flush).toHaveBeenCalled()
    collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 4, col: 3, input: 'closing' }))
    await collab.close()
    expect(sent(server)).toContain('closing')
    collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 5, col: 3, input: 'gone' })) // no throw
  })

  it('closes a room that finishes opening after the editor has gone', async () => {
    const server = await seeded()
    const { collab } = editor(server)
    const client = await newClient()
    const opened = collab.open(client)
    await collab.close()
    // The editor stops the engine as soon as close() resolves: the late room is already closed.
    expect(server.rooms[0]!.close).toHaveBeenCalledTimes(1)
    client.terminate()
    expect(await opened).toBe('disabled')
  })

  it('tells the room when access is lost and back', async () => {
    const server = await seeded()
    const { collab } = editor(server)
    await collab.open(await newClient())
    await collab.loseAccess('lost_edit')
    expect(server.rooms[0]!.loseAccess).toHaveBeenCalledWith('lost_edit')
    const mayEdit = () => true
    await collab.regainAccess(mayEdit)
    expect(server.rooms[0]!.regainAccess).toHaveBeenCalledWith(mayEdit)
  })

  it("tells the person when someone else's edit is in the way of an undo", async () => {
    const server = await seeded()
    const a = editor(server)
    const b = editor(server)
    await a.collab.open(await newClient())
    await b.collab.open(await newClient())
    a.collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 1, col: 1, input: 'mine' }))
    await a.collab.commit()
    server.deliver()
    b.collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 1, col: 1, input: 'theirs' }))
    await b.collab.commit()
    server.deliver()
    const result = await a.collab.undo()
    expect(result?.refused).toBe('edited')
    expect(toast.info).toHaveBeenCalledWith("Can't undo: someone else edited it")
    expect(sent(server)).toEqual(['theirs'])
  })

  it("hands another tab's change to the editor to repaint", async () => {
    const server = await seeded()
    const a = editor(server)
    const b = editor(server)
    await a.collab.open(await newClient())
    await b.collab.open(await newClient())
    a.collab.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 9, col: 9, input: 'x' }))
    await a.collab.commit()
    server.deliver()
    expect(b.onRemote).toHaveBeenCalledWith(expect.objectContaining({ cells: true }))
  })

  it('follows the room: saving, full, lost access, viewer', async () => {
    const server = await seeded()
    const { collab } = editor(server)
    await collab.open(await newClient())
    const room = server.rooms[0]!
    expect(collab.saveState.value).toBe('clean')
    room.setStatus({ saveState: 'saving', unsentCount: 1 })
    expect(collab.saveState.value).toBe('saving')
    room.setStatus({ saveState: 'clean', unsentCount: 0, isAtLimit: true })
    expect(collab.banner.value?.text).toBe('This sheet is full: delete some data to keep editing.')
    expect(collab.editingState.value).toBe('editing')
    room.setStatus({ isAtLimit: false, canWrite: false, blockReason: 'lost_edit' })
    expect(collab.editingState.value).toBe('closed')
    expect(collab.banner.value?.text).toBe('You can no longer edit this spreadsheet.')
    room.setStatus({ blockReason: null })
    expect(collab.editingState.value).toBe('closed') // a viewer
    expect(collab.banner.value).toBeNull()
  })

  it('asks to be opened again when the room needs it and nothing is kept nowhere', async () => {
    const server = await seeded()
    const { collab, onReopen } = editor(server)
    await collab.open(await newClient())
    server.rooms[0]!.setStatus({ isReopenNeeded: true, unsentCount: 2, isKeptOnDevice: false })
    expect(onReopen).not.toHaveBeenCalled()
    server.rooms[0]!.setStatus({ unsentCount: 0 })
    expect(onReopen).toHaveBeenCalled()
  })

  it('shows a sheet waiting for its conversion read-only, then reopens once it is converted', async () => {
    let converted = false
    const probe = vi.fn(async () => converted)
    const { collab, onReopen } = editor(fakeServer(), {
      open: async () => ({ state: 'unconverted' as const }),
      probe,
      retryMs: 5,
    })
    expect(await collab.open(await newClient())).toBe('unconverted')
    expect(collab.editingState.value).toBe('closed')
    expect(collab.banner.value?.text).toContain('being upgraded')
    await vi.waitFor(() => expect(probe.mock.calls.length).toBeGreaterThan(1))
    expect(onReopen).not.toHaveBeenCalled()
    converted = true
    await vi.waitFor(() => expect(onReopen).toHaveBeenCalledTimes(1))
    await collab.close()
  })

  it('closes the room', async () => {
    const server = await seeded()
    const { collab } = editor(server)
    await collab.open(await newClient())
    await collab.close()
    expect(server.rooms[0]!.close).toHaveBeenCalledTimes(1)
    expect(collab.isLive.value).toBe(false)
  })
})
