import { describe, expect, it, vi } from 'vitest'

import { cellId } from '../../utils/cells.js'
import { useSmartFill } from './useSmartFill.js'

type Rect = { r0: number; c0: number; r1: number; c1: number }

function setup(cells: Record<string, string>, sel: Rect) {
  const writes: Record<string, string>[] = []
  const history = { pushOp: vi.fn() }
  const { runSmartFill } = useSmartFill({
    readInputs: async (rect: Rect) => {
      const out: Record<string, string> = {}
      for (let r = rect.r0; r <= rect.r1; r++)
        for (let c = rect.c0; c <= rect.c1; c++) out[cellId(r, c)] = cells[cellId(r, c)] ?? ''
      return out
    },
    writeInputs: (_sn: string, map: Record<string, string>) => writes.push(map),
    currentSheet: { value: 'Sheet1' },
    getGrid: () => ({ getSelection: () => sel }),
    queueOp: vi.fn(),
    getHistory: () => history,
    getIsDirty: () => ({ value: false }),
  })
  return { runSmartFill, writes, history }
}

describe('runSmartFill', () => {
  it('learns from example rows and fills the empty rows as one write', async () => {
    const h = setup(
      {
        A1: 'ada lovelace',
        A2: 'alan turing',
        A3: 'grace hopper',
        A4: 'linus torvalds',
        B1: 'ADA LOVELACE',
        B2: 'ALAN TURING',
      },
      { r0: 0, c0: 1, r1: 3, c1: 1 },
    )
    const result = await h.runSmartFill()
    expect(result.ok).toBe(true)
    expect(h.writes).toEqual([{ B3: 'GRACE HOPPER', B4: 'LINUS TORVALDS' }])
    expect(h.history.pushOp).toHaveBeenCalledWith(
      expect.objectContaining({ before: { B3: '', B4: '' }, cellRefs: ['B3', 'B4'] }),
    )
  })

  it('needs an example first', async () => {
    const h = setup({ A1: 'x' }, { r0: 0, c0: 1, r1: 1, c1: 1 })
    expect(await h.runSmartFill()).toEqual({ ok: false, reason: 'no-examples' })
    expect(h.writes).toEqual([])
  })

  it('works on one column only', async () => {
    const h = setup({}, { r0: 0, c0: 0, r1: 1, c1: 1 })
    expect(await h.runSmartFill()).toEqual({ ok: false, reason: 'single-column-only' })
  })
})
