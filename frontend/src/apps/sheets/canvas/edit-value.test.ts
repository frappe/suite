// What the in-cell editor opens with when editing an existing cell.
//
// A formula cell displays its result but must open with its formula, as in
// Google Sheets and Excel. Seeding the editor with the display value meant
// double-click / F2 / Enter followed by a click away committed the result
// over the formula.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createGrid } from './index.js'
import { createMockCtx } from './painters/test-utils.js'

const inputs: Record<string, string> = { A1: '=AVERAGE(B1:C1)' }
const displays: Record<string, string> = { A1: '20' }

function mount({
  onInput,
  ...cellOpts
}: { onInput?: (id: string, v: string) => void; getEditValue?: undefined } = {}) {
  const parent = document.createElement('div')
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(createMockCtx())
  parent.appendChild(canvas)
  document.body.appendChild(parent)
  const grid = createGrid(canvas, {
    cells: {
      getStyle: () => ({}),
      getDisplay: (id: string) => displays[id] ?? '',
      getEditValue: (id: string) => inputs[id] ?? '',
      ...cellOpts,
    },
    host: { canEdit: () => true, ...(onInput ? { onInput } : {}) },
    lazyValues: true,
  })
  grid.resize(800, 600)
  const editor = () => parent.querySelector('textarea') as HTMLTextAreaElement | null
  const press = (key: string) => {
    const target = grid.isEditing() ? editor()! : canvas
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }
  return { grid, editor, press }
}

describe('in-cell editor seed value', () => {
  let h: ReturnType<typeof mount>
  beforeEach(() => {
    document.body.innerHTML = ''
    h = mount()
  })

  it('opens a formula cell with its formula on Enter', () => {
    h.press('Enter')
    expect(h.editor()!.value).toBe('=AVERAGE(B1:C1)')
  })

  it('opens a formula cell with its formula on F2', () => {
    h.press('F2')
    expect(h.editor()!.value).toBe('=AVERAGE(B1:C1)')
  })

  it('reports the formula to the host, which shows it in the formula bar', () => {
    const onInput = vi.fn()
    h = mount({ onInput })
    h.press('F2')
    expect(onInput).toHaveBeenCalledWith('A1', '=AVERAGE(B1:C1)')
  })

  it('falls back to the display value when the host has no getEditValue', () => {
    h = mount({ getEditValue: undefined })
    h.press('F2')
    expect(h.editor()!.value).toBe('20')
  })
})
