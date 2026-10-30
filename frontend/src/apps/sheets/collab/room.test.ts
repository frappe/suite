import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  CollabOpenError,
  type CollabRoom,
  type CollabSession,
  type Opened,
} from '@/platform/collab'

import { sheetsAdapter } from './adapter'
import { isLiveNow, openSheetRoom, type SheetRoom } from './room'
import { roots } from './schema'
import { docSheets } from './stores'
import { fakeServer } from './test-room'
import { cmd, makeStores, newClient, openTab, type Tab } from './test-tabs'

// Real IronCalc workbooks, several round trips each.
const ROOM_TIMEOUT = 30_000

const session = { nodeId: 'n1' } as unknown as CollabSession

async function openSheet(open: () => Promise<Opened>): Promise<SheetRoom> {
  const opened = await openSheetRoom({
    session,
    client: await newClient(),
    stores: makeStores(),
    open,
  })
  if (opened.state !== 'live') throw new Error(opened.state)
  return opened.sheet
}

// The cells a tab's IronCalc holds, as { A1: input }.
async function cells(sheet: SheetRoom, client = clientOf(sheet)): Promise<Record<string, string>> {
  await sheet.glue.settled()
  const { cells: flat } = await client.usedCells({ sheet: 'Sheet1' })
  const want = []
  for (let i = 0; i < flat.length; i += 2) want.push({ row: flat[i]!, col: flat[i + 1]! })
  if (!want.length) return {}
  const res = await client.readCells({ sheet: 'Sheet1', cells: want, what: ['input'] })
  return Object.fromEntries(
    res.cells.map((c) => [`${String.fromCharCode(64 + c.col)}${c.row}`, c.input ?? '']),
  )
}

// openSheet hands the client to the glue only; tests keep it beside the room.
const clients = new WeakMap<SheetRoom, Awaited<ReturnType<typeof newClient>>>()
const clientOf = (s: SheetRoom) => clients.get(s)!
async function openWithClient(open: () => Promise<Opened>) {
  const client = await newClient()
  const opened = await openSheetRoom({ session, client, stores: makeStores(), open })
  if (opened.state !== 'live') throw new Error(opened.state)
  clients.set(opened.sheet, client)
  return opened.sheet
}

async function typeIn(sheet: SheetRoom, row: number, col: number, input: string) {
  sheet.glue.dispatch(cmd('setInput', { sheet: 'Sheet1', row, col, input }))
  await sheet.glue.commit()
}

async function existingSheet(): Promise<Tab> {
  const t = await openTab('seed')
  t.glue.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 2, col: 1, input: '42' }))
  await t.glue.commit()
  return t
}

describe('openSheetRoom', { timeout: ROOM_TIMEOUT }, () => {
  it('tells the editor to keep the old path while Sheets collaboration is off', async () => {
    const open = () => Promise.resolve<Opened>({ state: 'disabled' })
    const opened = await openSheetRoom({ session, client: await newClient(), stores: {}, open })
    expect(opened).toEqual({ state: 'disabled' })
  })

  it('keeps the old path where the server has no Sheets editor registered', async () => {
    const open = () => Promise.reject(new CollabOpenError(404, 'not_found'))
    const opened = await openSheetRoom({ session, client: await newClient(), stores: {}, open })
    expect(opened).toEqual({ state: 'disabled' })
  })

  it('keeps the old path when the server has no route for it', async () => {
    const open = () => Promise.reject(new CollabOpenError(404, null))
    const opened = await openSheetRoom({ session, client: await newClient(), stores: {}, open })
    expect(opened).toEqual({ state: 'disabled' })
  })

  it('keeps the old path for a guest the room refuses (a link guest, or no Sheets editor)', async () => {
    // The client reports a guest's 403/404 as signed out: it can't tell them apart.
    document.cookie = 'user_id=Guest; path=/'
    const open = () => Promise.reject(new CollabOpenError(401, 'signed_out'))
    const opened = await openSheetRoom({ session, client: await newClient(), stores: {}, open })
    expect(opened).toEqual({ state: 'disabled' })
  })

  it('fails when a signed-in person is refused as signed out', async () => {
    document.cookie = 'user_id=ann%40x.com; path=/'
    const open = () => Promise.reject(new CollabOpenError(401, 'signed_out'))
    await expect(
      openSheetRoom({ session, client: await newClient(), stores: {}, open }),
    ).rejects.toThrow('signed_out')
    document.cookie = 'user_id=Guest; path=/'
  })

  it('fails on any other refusal to open', async () => {
    const open = () => Promise.reject(new CollabOpenError(401, 'locked'))
    await expect(
      openSheetRoom({ session, client: await newClient(), stores: {}, open }),
    ).rejects.toThrow('locked')
  })

  it('says when the sheet still waits for its conversion', async () => {
    const open = () => Promise.resolve<Opened>({ state: 'unconverted' })
    const opened = await openSheetRoom({ session, client: await newClient(), stores: {}, open })
    expect(opened).toEqual({ state: 'unconverted' })
  })

  it('opens with the Sheets adapter', async () => {
    const server = fakeServer((await existingSheet()).doc)
    const open = vi.fn(server.open)
    await openSheet(open)
    expect(open).toHaveBeenCalledWith({ session, adapter: sheetsAdapter })
  })

  it("builds the workbook from the room's doc", async () => {
    const server = fakeServer((await existingSheet()).doc)
    const sheet = await openWithClient(server.open)
    expect(await cells(sheet)).toEqual({ A2: '42' })
  })

  it("writes with the room's clientID", async () => {
    const server = fakeServer((await existingSheet()).doc)
    const sheet = await openSheet(server.open)
    expect(sheet.doc.clientID).toBe(sheet.room.doc.clientID)
  })

  it('fills an empty room from the new workbook, and the room sends it', async () => {
    const server = fakeServer()
    await openSheet(server.open)
    const sent = server.rooms[0]!.doc
    expect(docSheets(sent).map((s) => s.name)).toEqual(['Sheet1'])
    expect(server.rooms[0]!.outbox.length).toBeGreaterThan(0)
  })

  it("a tab's edit reaches the other tab's workbook", async () => {
    const server = fakeServer((await existingSheet()).doc)
    const a = await openWithClient(server.open)
    const b = await openWithClient(server.open)
    await typeIn(a, 1, 3, '=A2*2')
    server.deliver()
    expect(await cells(b)).toEqual({ A2: '42', C1: '=A2*2' })
  })

  it('holds a server update while an action is open, so the action lands on its own row', async () => {
    const server = fakeServer((await existingSheet()).doc)
    const a = await openWithClient(server.open)
    const b = await openWithClient(server.open)
    // A types into row 3 but hasn't committed when B's row insert above arrives.
    a.glue.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 3, col: 1, input: 'mine' }))
    b.glue.dispatch(cmd('insertRows', { sheet: 'Sheet1', row: 1, count: 1 }))
    await b.glue.commit()
    server.deliver()
    await a.glue.commit()
    server.deliver()
    // Row 3 moved down to 4 under B's insert, with A's text in it.
    expect(await cells(a)).toEqual({ A3: '42', A4: 'mine' })
    expect(await cells(b)).toEqual({ A3: '42', A4: 'mine' })
  })

  it("doesn't send the server's own updates back", async () => {
    const server = fakeServer((await existingSheet()).doc)
    const a = await openSheet(server.open)
    await openSheet(server.open)
    await typeIn(a, 1, 1, 'x')
    server.deliver()
    await Promise.resolve()
    expect(server.rooms[1]!.outbox).toEqual([])
  })

  it('closes the room and stops following it', async () => {
    const server = fakeServer((await existingSheet()).doc)
    const a = await openWithClient(server.open)
    const b = await openSheet(server.open)
    await a.close()
    expect(a.room.close).toHaveBeenCalledTimes(1)
    await typeIn(b, 1, 1, 'late')
    server.deliver()
    expect(roots(a.room.doc).inputs.size).toBe(2) // the room still hears it; the glue doesn't
  })

  it('closes the room when building the workbook fails', async () => {
    const server = fakeServer((await existingSheet()).doc)
    const client = await newClient()
    const broken = {
      snapshot: () => ({}),
      restore() {
        throw new Error('bad comments')
      },
    }
    const stores = { ...makeStores(), comments: broken } as unknown as ReturnType<typeof makeStores>
    let room: CollabRoom | undefined
    const open = async () => {
      const opened = await server.open()
      if (opened.state === 'live') room = opened.room
      return opened
    }
    await expect(openSheetRoom({ session, client, stores, open })).rejects.toThrow('bad comments')
    expect(room!.close).toHaveBeenCalledTimes(1)
  })

  it('asks whether a sheet opens live without keeping the room', async () => {
    const server = fakeServer()
    expect(await isLiveNow(session, server.open)).toBe(true)
    expect(server.rooms[0]!.close).toHaveBeenCalledTimes(1)
    expect(await isLiveNow(session, async () => ({ state: 'unconverted' }))).toBe(false)
  })

  it('keeps the room clientID through forwarded commits and a restore made in the room', async () => {
    // Yjs gives a doc a new clientID when an update from elsewhere carries its own
    // client's writes; the server refuses a push written by any other client.
    const server = fakeServer((await existingSheet()).doc)
    const a = await openWithClient(server.open)
    const id = a.room.doc.clientID
    await typeIn(a, 4, 1, 'forwarded')
    expect(a.room.doc.clientID).toBe(id)
    server.rooms[0]!.outbox.splice(0)
    // A restore writes into the room's doc directly (collab/restore.ts), then reaches the glue.
    a.room.doc.transact(() => roots(a.room.doc).inputs.set('restored-key', 'x'))
    await a.glue.settled()
    await typeIn(a, 5, 1, 'after restore')
    expect(a.doc.clientID).toBe(id)
    const writers = server.rooms[0]!.outbox.flatMap((u) =>
      Y.decodeUpdate(u).structs.map((st) => st.id.client),
    )
    expect(new Set(writers)).toEqual(new Set([id]))
  })
})
