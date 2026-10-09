import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { beforeEach, describe, expect, it } from 'vitest'

import { createWorkbookClient, WorkerRequestError } from './client.js'
import { CommandTypes } from './commands.js'
import { createDisplayCache } from './display-cache.js'
import { createWorkerHost } from './worker.js'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

// Stands in for a Worker: messages reach the real host asynchronously and
// the reply comes back on a later task, as they would across threads.
function fakePort() {
  const host = createWorkerHost()
  const port = {
    sent: [],
    onmessage: null,
    postMessage(message) {
      port.sent.push(message)
      setTimeout(() => port.onmessage?.({ data: host.handle(structuredClone(message)) }), 0)
    },
  }
  return port
}

let seq = 0
const cmd = (type, payload) => ({ id: `c${seq++}`, actor: 'test', ts: seq, type, payload })
const setInput = (sheet, row, col, input) => cmd(CommandTypes.setInput, { sheet, row, col, input })
const applies = (port) => port.sent.filter((m) => m.type === 'apply')

let port
beforeEach(() => {
  port = fakePort()
})

describe('client — init and reads', () => {
  it('initialises the worker and exposes the sheet list', async () => {
    const wb = await createWorkbookClient({ port })
    expect(wb.sheets).toEqual(['Sheet1'])
    expect(wb.getVersion()).toBe(0)
    expect(port.sent[0]).toMatchObject({ reqId: 1, type: 'init', payload: { snapshotBytes: null } })
  })

  it('keeps the sheet list current and reports changes to it', async () => {
    const wb = await createWorkbookClient({ port })
    const seen = []
    wb.onSheets((s) => seen.push(s))
    wb.dispatch(cmd(CommandTypes.addSheet, { name: 'Data' }))
    await wb.idle()
    wb.dispatch(setInput('Sheet1', 1, 1, 'x'))
    await wb.idle()
    expect(wb.sheets).toEqual(['Sheet1', 'Data'])
    expect(seen).toEqual([['Sheet1', 'Data']])
  })

  it('reads after the edits already dispatched, so a new sheet can be read at once', async () => {
    const wb = await createWorkbookClient({ port })
    wb.dispatch(setInput('Sheet1', 1, 1, 'x'))
    await Promise.resolve()
    // The first apply is now in flight; this one waits in the queue.
    wb.dispatch(cmd(CommandTypes.addSheet, { name: 'New' }))
    const read = wb.readViewport({ sheet: 'New', r1: 1, c1: 1, r2: 1, c2: 1 })
    await expect(read).resolves.toEqual({ values: [['']] })
  })

  it('round-trips readViewport and readCells', async () => {
    const wb = await createWorkbookClient({ port })
    wb.dispatch(setInput('Sheet1', 1, 1, '10'))
    wb.dispatch(setInput('Sheet1', 1, 2, '30'))
    wb.dispatch(setInput('Sheet1', 1, 3, '=AVERAGE(A1:B1)'))
    await wb.idle()

    expect((await wb.readViewport({ sheet: 'Sheet1', r1: 1, c1: 1, r2: 1, c2: 3 })).values).toEqual(
      [['10', '30', '20']],
    )
    const { cells } = await wb.readCells({
      sheet: 'Sheet1',
      cells: [{ row: 1, col: 3 }],
      what: ['input'],
    })
    expect(cells).toEqual([{ row: 1, col: 3, input: '=AVERAGE(A1:B1)' }])
  })

  it('rejects a failed request with the worker error', async () => {
    const wb = await createWorkbookClient({ port })
    const read = wb.readViewport({ sheet: 'Nope', r1: 1, c1: 1, r2: 1, c2: 1 })
    await expect(read).rejects.toBeInstanceOf(WorkerRequestError)
    await expect(read).rejects.toThrow(/unknown sheet/)
  })

  it('matches out-of-order replies by reqId', async () => {
    const wb = await createWorkbookClient({ port })
    wb.dispatch(setInput('Sheet1', 1, 1, 'a'))
    wb.dispatch(setInput('Sheet1', 2, 1, 'b'))
    await wb.idle()
    const [first, second] = await Promise.all([
      wb.readViewport({ sheet: 'Sheet1', r1: 1, c1: 1, r2: 1, c2: 1 }),
      wb.readViewport({ sheet: 'Sheet1', r1: 2, c1: 1, r2: 2, c2: 1 }),
    ])
    expect(first.values).toEqual([['a']])
    expect(second.values).toEqual([['b']])
  })
})

describe('client — dispatch', () => {
  it('throws on an invalid command and sends nothing', async () => {
    const wb = await createWorkbookClient({ port })
    expect(() => wb.dispatch({ type: 'setInput', payload: {} })).toThrow()
    await wb.idle()
    expect(applies(port)).toHaveLength(0)
  })

  it('coalesces a synchronous burst into one apply', async () => {
    const wb = await createWorkbookClient({ port })
    for (let r = 1; r <= 5; r++) wb.dispatch(setInput('Sheet1', r, 1, String(r)))
    await wb.idle()
    expect(applies(port)).toHaveLength(1)
    expect(applies(port)[0].payload.commands).toHaveLength(5)
  })

  it('keeps one apply in flight and batches what arrives meanwhile', async () => {
    const wb = await createWorkbookClient({ port })
    wb.dispatch(setInput('Sheet1', 1, 1, '1'))
    await Promise.resolve() // let the first apply leave
    wb.dispatch(setInput('Sheet1', 2, 1, '2'))
    wb.dispatch(setInput('Sheet1', 3, 1, '3'))
    await wb.idle()
    expect(applies(port).map((m) => m.payload.commands.length)).toEqual([1, 2])
  })

  it('notifies version listeners after apply', async () => {
    const wb = await createWorkbookClient({ port })
    const seen = []
    wb.onVersion((v) => seen.push(v))
    wb.dispatch(setInput('Sheet1', 1, 1, '1'))
    wb.dispatch(setInput('Sheet1', 2, 1, '2'))
    await wb.idle()
    expect(seen).toEqual([2])
    expect(wb.getVersion()).toBe(2)
  })

  it('unsubscribes a version listener', async () => {
    const wb = await createWorkbookClient({ port })
    const seen = []
    const off = wb.onVersion((v) => seen.push(v))
    off()
    wb.dispatch(setInput('Sheet1', 1, 1, '1'))
    await wb.idle()
    expect(seen).toEqual([])
  })
})

// Wires a real DisplayCache the way the page will: echo in, clear on
// every version bump, refill with readViewport.
async function connected() {
  const cache = createDisplayCache()
  const wb = await createWorkbookClient({ port, echo: cache })
  wb.onVersion((v) => cache.clear(v))
  const refill = async (r1, c1, r2, c2) => {
    const v = wb.getVersion()
    return cache.fill(
      'Sheet1',
      r1,
      c1,
      await wb.readViewport({ sheet: 'Sheet1', r1, c1, r2, c2 }),
      v,
    )
  }
  return { wb, cache, refill }
}

describe('client — optimistic echo', () => {
  it('echoes setInput before the worker replies, then shows the evaluated value', async () => {
    const { wb, cache, refill } = await connected()
    wb.dispatch(setInput('Sheet1', 1, 1, '=1+1'))
    expect(cache.get('Sheet1', 1, 1)).toEqual({ display: '=1+1', input: '=1+1', provisional: true })

    await wb.idle()
    expect(cache.get('Sheet1', 1, 1)).toBeUndefined()
    await refill(1, 1, 1, 1)
    expect(cache.get('Sheet1', 1, 1)).toEqual({ display: '2' })
  })

  it('keeps text typed during an in-flight apply across its version bump', async () => {
    const { wb, cache } = await connected()
    wb.dispatch(setInput('Sheet1', 1, 1, 'first'))
    await Promise.resolve() // first apply leaves
    wb.dispatch(setInput('Sheet1', 2, 1, 'second'))

    await new Promise((resolve) => wb.onVersion(resolve)) // first apply's bump
    expect(cache.get('Sheet1', 2, 1)).toEqual({
      display: 'second',
      input: 'second',
      provisional: true,
    })
    await wb.idle()
  })

  it('does not echo other command types', async () => {
    const { wb, cache } = await connected()
    wb.dispatch(cmd(CommandTypes.insertRows, { sheet: 'Sheet1', row: 1, count: 1 }))
    expect(cache.size).toBe(0)
    await wb.idle()
  })

  it('drops the echo and reports when the command fails', async () => {
    const { wb, cache } = await connected()
    const failures = []
    wb.onCommandError((f) => failures.push(f))
    const bad = setInput('Nope', 1, 1, 'x')
    wb.dispatch(bad)
    expect(cache.get('Nope', 1, 1)?.provisional).toBe(true)
    await wb.idle()
    expect(cache.get('Nope', 1, 1)).toBeUndefined()
    expect(failures).toHaveLength(1)
    expect(failures[0].command.id).toBe(bad.id)
    expect(failures[0].error).toMatch(/unknown sheet/)
  })
})

describe('client — snapshots', () => {
  it('toBytes includes commands still queued', async () => {
    const wb = await createWorkbookClient({ port })
    wb.dispatch(setInput('Sheet1', 1, 1, '42'))
    const bytes = await wb.toBytes()

    const restored = await createWorkbookClient({ port: fakePort(), snapshotBytes: bytes })
    expect(
      (await restored.readViewport({ sheet: 'Sheet1', r1: 1, c1: 1, r2: 1, c2: 1 })).values,
    ).toEqual([['42']])
  })

  it('terminate rejects requests still waiting', async () => {
    const wb = await createWorkbookClient({ port })
    const read = wb.readViewport({ sheet: 'Sheet1', r1: 1, c1: 1, r2: 1, c2: 1 })
    wb.terminate()
    await expect(read).rejects.toThrow(/terminated/)
  })
})

describe('client — restore', () => {
  const inputAt = async (wb, row, col) =>
    (await wb.readCells({ sheet: 'Sheet1', cells: [{ row, col }], what: ['input'] })).cells[0].input

  it('replaces the workbook, keeping its place among dispatched commands', async () => {
    const wb = await createWorkbookClient({ port })
    wb.dispatch(setInput('Sheet1', 1, 1, 'saved'))
    const bytes = await wb.toBytes()
    wb.dispatch(setInput('Sheet1', 1, 1, 'changed'))
    const restored = wb.restore(bytes)
    wb.dispatch(setInput('Sheet1', 2, 1, 'after'))
    await restored
    expect(await inputAt(wb, 1, 1)).toBe('saved') // 'changed' went first, then was replaced
    expect(await inputAt(wb, 2, 1)).toBe('after') // dispatched later, applied on top
  })

  it('keeps versions increasing, so cached values are dropped', async () => {
    const wb = await createWorkbookClient({ port })
    wb.dispatch(setInput('Sheet1', 1, 1, 'x'))
    const bytes = await wb.toBytes()
    const versions = []
    wb.onVersion((v) => versions.push(v))
    const before = wb.getVersion()
    await wb.restore(bytes)
    expect(versions).toEqual([before + 1])
  })

  it('rejects bad bytes and leaves the workbook as it was', async () => {
    const wb = await createWorkbookClient({ port })
    wb.dispatch(setInput('Sheet1', 1, 1, 'kept'))
    await expect(wb.restore(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    expect(await inputAt(wb, 1, 1)).toBe('kept')
  })
})
