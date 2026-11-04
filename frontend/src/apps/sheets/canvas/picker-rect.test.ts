// The formula range highlight (a picked range, or the "Tab to fill range"
// suggestion) must not hide the values it frames (ISSUES #83). Its fill is a
// solid theme grey, so like the selection fill it has to go under the cell
// text; only the dashed border goes on top.
import { describe, expect, it } from 'vitest'

import { cellId } from '../utils/cells.js'
import { COLORS } from './constants.js'
import { createRenderer } from './renderer.js'

type Call = { op: string; fillStyle: string; args: unknown[] }

// A 2D context that records every call with the fill colour at that moment.
function createRecordingCtx() {
  const calls: Call[] = []
  const state: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    lineDashOffset: 0,
    globalAlpha: 1,
  }
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (key === 'measureText') return (t: string) => ({ width: String(t).length * 7 })
      return (...args: unknown[]) => {
        calls.push({ op: key, fillStyle: String(target.fillStyle), args })
      }
    },
    set(target, key: string, value) {
      target[key] = value
      return true
    },
  })
  return { ctx, calls }
}

function createGeometry() {
  return {
    cw: () => 100,
    rh: () => 24,
    colX: (c: number) => 50 + c * 100,
    rowY: (r: number) => 24 + r * 24,
    firstVisCol: () => 0,
    firstVisRow: () => 0,
    lastVisCol: () => 3,
    lastVisRow: () => 6,
    frozenW: () => 0,
    frozenH: () => 0,
    isFilterHidden: () => false,
    totalRows: () => 1000,
    totalCols: () => 26,
  }
}

// C2:C4 (0-based rows 1-3, col 2) hold numbers; the picker frames them while
// C5 is being edited.
function paintWithPicker() {
  const { ctx, calls } = createRecordingCtx()
  const renderer = createRenderer(ctx as never, createGeometry())
  const values: Record<string, string> = {
    [cellId(1, 2)]: '12',
    [cellId(2, 2)]: '45',
    [cellId(3, 2)]: '78',
  }
  renderer.render({
    cssW: 400,
    cssH: 200,
    getValue: (id: string) => values[id] ?? '',
    cells: { getStyle: () => ({}) },
    sel: { r: 4, c: 2 },
    selEnd: { r: 4, c: 2 },
    selMode: 'cell',
    editing: true,
    freeze: { rows: 0, cols: 0 },
    getDiffFor: null,
    marchAnts: null,
    marchPhase: 0,
    pickerRect: { r0: 1, c0: 2, r1: 3, c1: 2 },
    colDrag: null,
    zoom: 1,
  } as never)
  return calls
}

describe('formula range highlight', () => {
  it('paints its fill before the values it frames', () => {
    const calls = paintWithPicker()
    const fill = calls.findIndex((c) => c.op === 'fillRect' && c.fillStyle === COLORS.pickerFill)
    const text = calls.findIndex((c) => c.op === 'fillText' && c.args[0] === '12')

    expect(fill).toBeGreaterThanOrEqual(0)
    expect(text).toBeGreaterThanOrEqual(0)
    expect(fill).toBeLessThan(text)
  })

  it('paints no fill over the values after drawing them', () => {
    const calls = paintWithPicker()
    const lastText = calls.findLastIndex((c) => c.op === 'fillText' && c.args[0] === '78')
    const laterFill = calls
      .slice(lastText + 1)
      .some((c) => c.op === 'fillRect' && c.fillStyle === COLORS.pickerFill)

    expect(laterFill).toBe(false)
  })

  it('still draws its dashed border on top of the values', () => {
    const calls = paintWithPicker()
    const lastText = calls.findLastIndex((c) => c.op === 'fillText' && c.args[0] === '78')
    const dashed = calls.findIndex(
      (c, i) => i > lastText && c.op === 'setLineDash' && (c.args[0] as number[])[0] === 6,
    )

    expect(dashed).toBeGreaterThan(lastText)
  })
})
