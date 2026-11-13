import { describe, expect, it } from 'vitest'

import { clearTypedFormats, type Rect } from './typed-formats'

interface Sent {
  type: string
  payload: unknown
}
const command = (type: string, payload: unknown): Sent => ({ type, payload })

describe('clearTypedFormats', () => {
  // A1 = 15% (shows 0.15 once reset), B1 = a formula, A2 = a date (shows
  // its serial once reset). The read must see the cells after the reset.
  function setup() {
    const sent: Sent[] = []
    let reset = false
    const reads: Rect[] = []
    const deps = {
      dispatch: (cmd: unknown) => {
        // SAFETY: every command here comes from `command` above, and
        // clearTypedFormats dispatches only batches of them.
        const batch = cmd as { payload: { commands: Sent[] } }
        for (const sub of batch.payload.commands) {
          sent.push(sub)
          if (sub.type === 'setRangeStyle') reset = true
        }
      },
      command,
      readInputs: async (_sheet: string, rect: Rect) => {
        reads.push(rect)
        return reset
          ? [
              ['0.15', '=A1*2'],
              ['45306', ''],
            ]
          : [
              ['0.15', '=A1*2'],
              ['2024-01-15', ''],
            ]
      },
    }
    return { sent, reads, deps }
  }

  it('resets each cell, then stores its plain value as the input', async () => {
    const t = setup()
    await clearTypedFormats(['A1', 'B1', 'A2'], 'Sheet1', t.deps)
    expect(t.reads).toEqual([{ r0: 0, c0: 0, r1: 1, c1: 1 }])
    expect(t.sent.filter((c) => c.type === 'setRangeStyle')).toHaveLength(3)
    expect(t.sent.filter((c) => c.type === 'setInput').map((c) => c.payload)).toEqual([
      { sheet: 'Sheet1', row: 1, col: 1, input: '0.15' },
      { sheet: 'Sheet1', row: 2, col: 1, input: '45306' },
    ])
  })

  it('sends nothing for no cells', async () => {
    const t = setup()
    await clearTypedFormats([], 'Sheet1', t.deps)
    expect(t.sent).toEqual([])
    expect(t.reads).toEqual([])
  })
})
