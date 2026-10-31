import { describe, expect, it, vi } from 'vitest'

import { cellId } from '../../utils/cells.js'
import { useFill } from './useFill.js'

type Rect = { r0: number; c0: number; r1: number; c1: number }
type RowHeightChange = { before: Record<number, number>; after: Record<number, number> }

// In-memory stand-ins for the editor's helpers: one sheet of inputs and
// formats, no validation / merges / conditional-format rules.
function setup(
  inputs: Record<string, string>,
  fmts: Record<string, object> = {},
  refitRowsFor = vi.fn(() => null as RowHeightChange | null),
  engineFmts: Record<string, string> = {},
) {
  const cells = { ...inputs }
  const formatStore: Record<string, object> = { ...fmts }
  let selection: Rect = { r0: 0, c0: 0, r1: 0, c1: 0 }
  const readRect = (rect: Rect) => {
    const out: Record<string, string> = {}
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) out[cellId(r, c)] = cells[cellId(r, c)] ?? ''
    }
    return out
  }
  const history = { pushOp: vi.fn() }
  const queueOp = vi.fn()
  const fill = useFill({
    getGrid: () => ({ getSelection: () => selection }),
    currentSheet: { value: 'Sheet1' },
    formats: {
      get: (id: string) => formatStore[id],
      set: (id: string, f: object) => (formatStore[id] = { ...f }),
      clear: (id: string) => delete formatStore[id],
    },
    merge: { snapshot: () => ({}), getMasterInfo: () => null, merge: vi.fn() },
    validation: { get: () => null, set: vi.fn() },
    condFormat: { extendRulesToRange: vi.fn(), getRules: () => [] },
    history,
    isDirty: { value: false },
    syncFlags: vi.fn(),
    markEdited: vi.fn(),
    readInputs: async (rect: Rect) => readRect(rect),
    writeInputs: (_sn: string, writes: Record<string, string>) => Object.assign(cells, writes),
    captureFormatsRange: (rect: Rect) => {
      const out: Record<string, object | null> = {}
      for (const id of Object.keys(readRect(rect))) out[id] = formatStore[id] ?? null
      return out
    },
    captureValidationRange: () => ({}),
    diffRefs: (a: Record<string, string>, b: Record<string, string>) =>
      [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((id) => a[id] !== b[id]),
    queueOp,
    rectBlocked: () => false,
    refitRowsFor,
    readEngineFormats: async (rect: Rect) => {
      const out: Record<string, string> = {}
      for (const id of Object.keys(readRect(rect))) if (engineFmts[id]) out[id] = engineFmts[id]
      return out
    },
  })
  return {
    fill,
    cells,
    formatStore,
    history,
    queueOp,
    refitRowsFor,
    select: (rect: Rect) => (selection = rect),
  }
}

describe('Ctrl+D / Ctrl+R', () => {
  it('fill down copies the top row and its formats', async () => {
    const bold = { bold: true, backgroundColor: '#fff2cc' }
    const t = setup({ A1: '100', B1: '=A1*2' }, { A1: bold })
    t.select({ r0: 0, c0: 0, r1: 3, c1: 1 })
    t.fill.fillDown()
    await vi.waitFor(() => expect(t.cells.A4).toBe('100'))
    expect(t.cells.B4).toBe('=A4*2')
    for (const id of ['A2', 'A3', 'A4']) expect(t.formatStore[id]).toEqual(bold)
    expect(t.formatStore.B2).toBeUndefined()
  })

  it('fill right copies the left column and its formats', async () => {
    const italic = { italic: true }
    const t = setup({ A1: '7' }, { A1: italic })
    t.select({ r0: 0, c0: 0, r1: 0, c1: 2 })
    t.fill.fillRight()
    await vi.waitFor(() => expect(t.cells.C1).toBe('7'))
    expect(t.formatStore.B1).toEqual(italic)
    expect(t.formatStore.C1).toEqual(italic)
  })

  it('copies a number instead of counting up, and clears formats under an unformatted source', async () => {
    const t = setup({ A1: '1', A2: 'x' }, { A2: { bold: true } })
    t.select({ r0: 0, c0: 0, r1: 2, c1: 0 })
    t.fill.fillDown()
    await vi.waitFor(() => expect(t.cells.A3).toBe('1'))
    expect(t.cells.A2).toBe('1')
    expect(t.formatStore.A2).toBeUndefined()
  })

  it('records one undo step that restores the old formats', async () => {
    const bold = { bold: true }
    const t = setup({ A1: '5' }, { A1: bold })
    t.select({ r0: 0, c0: 0, r1: 1, c1: 0 })
    t.fill.fillDown()
    await vi.waitFor(() => expect(t.history.pushOp).toHaveBeenCalledTimes(1))
    const op = t.history.pushOp.mock.calls[0]?.[0]
    expect(op.beforeFormats.A2).toBeNull()
    expect(op.afterFormats.A2).toEqual(bold)
    expect(t.queueOp.mock.calls[0]?.[0].summary).toBe('Fill down')
  })
})

// A typed `$1.50` / `15%` is formatted by IronCalc (its input is 1.5 /
// 0.15); the fill carries that format like a side-store one.
describe('IronCalc formats', () => {
  it('fill down carries the format IronCalc gave a typed value', async () => {
    const t = setup(
      { A1: '1.5', B1: '0.15', C1: '7' },
      { C1: { numberFormat: 'number:2' } },
      undefined,
      {
        A1: '$#,##0.00',
        B1: '#,##0%',
        C1: '#,##0',
      },
    )
    t.select({ r0: 0, c0: 0, r1: 2, c1: 2 })
    t.fill.fillDown()
    await vi.waitFor(() => expect(t.cells.A3).toBe('1.5'))
    expect(t.formatStore.A3).toEqual({ numberFormat: 'currency:USD:2' })
    expect(t.formatStore.B2).toEqual({ numberFormat: 'percentage:0' })
    // A side-store format wins over IronCalc's.
    expect(t.formatStore.C2).toEqual({ numberFormat: 'number:2' })
  })
})

describe('wrapped rows', () => {
  it('refit to the filled values, and the height change undoes with the fill', async () => {
    const change = { before: { 1: 24 }, after: { 1: 54 } }
    const t = setup(
      { A1: 'a long line that wraps' },
      {},
      vi.fn(() => change),
    )
    t.select({ r0: 0, c0: 0, r1: 1, c1: 0 })
    t.fill.fillDown()
    await vi.waitFor(() => expect(t.history.pushOp).toHaveBeenCalledTimes(1))
    expect(t.refitRowsFor).toHaveBeenCalledWith('Sheet1', {
      A1: 'a long line that wraps',
      A2: 'a long line that wraps',
    })
    const op = t.history.pushOp.mock.calls[0]?.[0]
    expect(op.beforeRowH).toEqual(change.before)
    expect(op.afterRowH).toEqual(change.after)
  })

  it('leave the op without heights when no row changes', async () => {
    const t = setup({ A1: '5' })
    t.select({ r0: 0, c0: 0, r1: 1, c1: 0 })
    t.fill.fillDown()
    await vi.waitFor(() => expect(t.history.pushOp).toHaveBeenCalledTimes(1))
    expect(t.history.pushOp.mock.calls[0]?.[0]).not.toHaveProperty('beforeRowH')
  })
})
