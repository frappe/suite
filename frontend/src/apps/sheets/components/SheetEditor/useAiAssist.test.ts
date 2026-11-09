import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAiAssist } from './useAiAssist.js'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const asked = vi.hoisted(() => fromPartial<Array<Record<string, unknown>>>([]))

vi.mock('@/api', () => ({
  api: { sheets: { assistant: { ask: { path: 'ask' } } } },
  client: {
    query: async (_ref: unknown, args: Record<string, unknown>) => {
      asked.push(args)
      return { actions: [] }
    },
  },
}))

type Rect = { r0: number; c0: number; r1: number; c1: number }

function assist(readRect: (sn: string, rect: Rect) => Promise<unknown>) {
  return useAiAssist({
    getGrid: () => ({
      getSelection: () => ({ r0: 1, c0: 1, r1: 2, c1: 1 }),
      getActiveCell: () => 'B2',
    }),
    getDocName: () => 'sheet-1',
    currentSheet: { value: 'Data' },
    history: { pushOp: vi.fn() },
    isDirty: { value: false },
    syncFlags: vi.fn(),
    undo: vi.fn(),
    refreshActiveFormat: vi.fn(),
    readRect,
    readIds: async () => ({}),
    writeInputs: vi.fn(),
    cellSilentlyProtected: () => false,
    flashProtected: vi.fn(),
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('AI Assist context', () => {
  it("sends the sheet as the editor shows it: typed values, formulas' results", async () => {
    asked.length = 0
    const reads: Array<[string, Rect]> = []
    const ai = assist(async (sn, rect) => {
      reads.push([sn, rect])
      return {
        inputs: [
          ['', 'Amount'],
          ['', '5'],
          ['', '=B2*2'],
        ],
        displays: [
          ['', 'Amount'],
          ['', '$5.00'],
          ['', '10'],
        ],
      }
    })

    await ai.onAskSubmit('sum')

    // One row and column past what the server samples (25 × 40), so it can
    // say the view is partial
    expect(reads).toEqual([['Data', { r0: 0, c0: 0, r1: 25, c1: 40 }]])
    expect(asked).toHaveLength(1)
    expect(JSON.parse(fromPartial<string>(asked[0]!.cells))).toEqual({
      B1: 'Amount',
      B2: '5',
      B3: '10',
    })
    expect(asked[0]).toMatchObject({ name: 'sheet-1', prompt: 'sum' })
  })
})
