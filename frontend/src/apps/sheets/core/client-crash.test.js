// What happens when the worker dies or IronCalc panics. A real panic can't be
// triggered on purpose, so createWorkbook is wrapped to throw the error a Rust
// panic becomes (WebAssembly.RuntimeError) for one sentinel input.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createWorkbookClient, WorkerRequestError } from './client.js'
import { CommandTypes } from './commands.js'
import { createWorkerHost } from './worker.js'

vi.mock('./workbook.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    createWorkbook(opts) {
      const wb = mod.createWorkbook(opts)
      const apply = wb.apply
      wb.apply = (command) => {
        // The literal, not TRAP: vi.mock is hoisted above the constants.
        if (command?.payload?.input === '__trap__')
          throw new WebAssembly.RuntimeError('unreachable')
        return apply.call(wb, command)
      }
      return wb
    },
  }
})

const TRAP = '__trap__'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

let seq = 0
const cmd = (type, payload) => ({ id: `c${seq++}`, actor: 'test', ts: seq, type, payload })
const setInput = (sheet, row, col, input) => cmd(CommandTypes.setInput, { sheet, row, col, input })
const view = { sheet: 'Sheet1', r1: 1, c1: 1, r2: 1, c2: 1 }

// Same stand-in for a Worker as client.test.js, plus `error` events and
// `hold`, which leaves requests unanswered (a worker that died mid-request).
function fakePort() {
  const host = createWorkerHost()
  const port = {
    sent: [],
    hold: false,
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message) {
      port.sent.push(message)
      if (port.hold) return
      setTimeout(() => port.onmessage?.({ data: host.handle(structuredClone(message)) }), 0)
    },
    terminate() {
      port.terminated = true
    },
  }
  return port
}

describe('worker host — wasm trap', () => {
  let host
  let reqId
  const send = (type, payload = {}) => host.handle({ reqId: ++reqId, type, payload })
  beforeEach(() => {
    host = createWorkerHost()
    reqId = 0
    send('init', { snapshotBytes: null })
  })

  it('answers a trap as a fatal error, not as one failed command', () => {
    const res = send('apply', { commands: [setInput('Sheet1', 1, 1, TRAP)] })
    expect(res.error).toMatchObject({ message: 'unreachable', fatal: true })
  })

  it('fails every later request as fatal once the engine has trapped', () => {
    send('apply', { commands: [setInput('Sheet1', 1, 1, TRAP)] })
    const res = send('readViewport', view)
    expect(res.error).toMatchObject({ message: 'IronCalc crashed: unreachable', fatal: true })
  })

  it('keeps an ordinary command failure non-fatal', () => {
    const res = send('apply', {
      commands: [cmd(CommandTypes.setInput, { sheet: 'Nope', row: 1, col: 1, input: 'x' })],
    })
    expect(res.error).toBeUndefined()
    expect(res.result.results[0].ok).toBe(false)
    expect(send('readViewport', view).error).toBeUndefined()
  })
})

describe('client — crash', () => {
  let port
  beforeEach(() => {
    port = fakePort()
  })

  it('reports a trap once, stops the worker and fails later requests', async () => {
    const wb = await createWorkbookClient({ port })
    const reasons = []
    wb.onCrash((r) => reasons.push(r))
    const failures = []
    wb.onCommandError((f) => failures.push(f.error))
    wb.dispatch(setInput('Sheet1', 1, 1, TRAP))
    await wb.idle()
    expect(reasons).toEqual(['unreachable'])
    expect(failures).toEqual(['unreachable'])
    expect(port.terminated).toBe(true)
    await expect(wb.readViewport(view)).rejects.toThrow(WorkerRequestError)
    await expect(wb.toBytes()).rejects.toThrow('unreachable')
  })

  it('fails pending requests when the worker errors, instead of hanging', async () => {
    const wb = await createWorkbookClient({ port })
    const reasons = []
    wb.onCrash((r) => reasons.push(r))
    port.hold = true
    const pending = wb.readViewport(view)
    await vi.waitFor(() => expect(port.sent.at(-1).type).toBe('readViewport'))
    port.onerror({ message: 'out of memory' })
    await expect(pending).rejects.toThrow('worker error: out of memory')
    expect(reasons).toEqual(['worker error: out of memory'])
    // A second error event changes nothing.
    port.onerror({ message: 'again' })
    expect(reasons).toHaveLength(1)
  })

  it('fails edits dispatched after a crash and still goes idle', async () => {
    const wb = await createWorkbookClient({ port })
    port.onerror({ message: '' })
    const failures = []
    wb.onCommandError((f) => failures.push(f.error))
    wb.dispatch(setInput('Sheet1', 1, 1, 'x'))
    await wb.idle()
    expect(failures).toEqual(['worker error: unknown'])
  })

  it('treats an unreadable message as a crash', async () => {
    const wb = await createWorkbookClient({ port })
    const reasons = []
    wb.onCrash((r) => reasons.push(r))
    port.onmessageerror({})
    expect(reasons).toEqual(['worker sent a message that could not be read'])
  })

  it('does not report a crash after terminate()', async () => {
    const wb = await createWorkbookClient({ port })
    const reasons = []
    wb.onCrash((r) => reasons.push(r))
    wb.terminate()
    port.onerror({ message: 'late' })
    expect(reasons).toEqual([])
  })

  it('stops calling a listener that unsubscribed', async () => {
    const wb = await createWorkbookClient({ port })
    const reasons = []
    const off = wb.onCrash((r) => reasons.push(r))
    off()
    port.onerror({ message: 'x' })
    expect(reasons).toEqual([])
  })
})
