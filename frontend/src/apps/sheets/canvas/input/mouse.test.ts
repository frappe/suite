import { describe, expect, it, vi } from 'vitest'

import { createSelection } from '../selection.js'
import type { Hit, HitTester } from './hit-test.js'
import { createMouse, type MouseGeometry, type MouseHost, type MouseOptions } from './mouse.js'

// The hit tester is scripted per test (`next`), so these tests are about what
// each press does, not the pixel maths (hit-test.test.ts covers that).
function setup(over: Partial<MouseOptions> = {}, host: MouseHost = {}) {
  document.body.innerHTML = ''
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  let next: Hit = { kind: 'none' }
  let cellUnder: { r: number; c: number } | null = null
  const hits: HitTester = { at: () => next, onFillHandle: () => false }
  const geo: MouseGeometry = {
    hitTest: () => cellUnder,
    hitTestColResize: () => null,
    hitTestRowResize: () => null,
    hitTestColHeader: () => null,
    colInsertIndex: () => 4,
    colX: (c) => c * 100,
    rowY: (r) => r * 20,
    cw: () => 100,
    rh: () => 20,
  }
  const sel = createSelection({
    clamp: (r, c) => ({ r, c }),
    totalRows: () => 100,
    totalCols: () => 26,
  })
  const widths: { [c: number]: number } = {}
  const editor = { isOpen: vi.fn(() => false), commit: vi.fn(), open: vi.fn() }
  const picker = {
    target: vi.fn((): HTMLInputElement | null => null),
    pickColumn: vi.fn(),
    pickRow: vi.fn(),
    pickCell: vi.fn(),
    isDragging: () => false,
    dragTo: vi.fn(),
    endDrag: vi.fn(),
  }
  const opts: MouseOptions = {
    canvas,
    geo,
    hits,
    picker,
    editor,
    sel,
    host,
    getZoom: () => 1,
    totalRows: () => 100,
    totalCols: () => 26,
    canEdit: () => true,
    moveSel: vi.fn((r: number, c: number) => sel.moveTo(r, c)),
    extendSel: vi.fn((r: number, c: number) => sel.extendTo(r, c)),
    resetTabAnchor: vi.fn(),
    resolveMaster: (r, c) => ({ r, c }),
    crossSheetName: () => null,
    editValue: () => '=A1*2',
    hyperlinkAt: () => undefined,
    validationAt: () => null,
    hasValue: () => false,
    colWidth: (c) => widths[c] ?? 100,
    rowHeight: () => 21,
    setColWidths: vi.fn((cols: readonly number[], w: number) => {
      for (const c of cols) widths[c] = w
    }),
    setRowHeights: vi.fn(),
    autoFitCol: vi.fn(),
    autoFitRow: vi.fn(),
    scrollBy: vi.fn(),
    render: vi.fn(),
    ...over,
  }
  const mouse = createMouse(opts)
  const fire = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }))
  return {
    mouse,
    opts,
    sel,
    editor,
    picker,
    canvas,
    widths,
    hit(h: Hit) {
      next = h
    },
    over(r: number, c: number) {
      cellUnder = { r, c }
    },
    down: (init: MouseEventInit = {}) => fire(canvas, 'mousedown', { detail: 1, ...init }),
    move: (init: MouseEventInit = {}) => fire(canvas, 'mousemove', init),
    up: (init: MouseEventInit = {}) => {
      fire(canvas, 'mouseup', init)
      fire(document, 'mouseup', init)
    },
    docMove: (init: MouseEventInit = {}) => fire(document, 'mousemove', init),
    dbl: () => fire(canvas, 'dblclick'),
  }
}

describe('press', () => {
  it('on a cell commits the editor and selects it', () => {
    const h = setup()
    h.hit({ kind: 'cell', r: 2, c: 3 })
    h.down()
    expect(h.editor.commit).toHaveBeenCalled()
    expect(h.opts.resetTabAnchor).toHaveBeenCalled()
    expect(h.sel.anchor).toEqual({ r: 2, c: 3 })
  })

  it('drag over cells extends the selection, release stops it', () => {
    const h = setup()
    h.hit({ kind: 'cell', r: 0, c: 0 })
    h.down()
    h.over(3, 2)
    h.move()
    expect(h.sel.range()).toMatchObject({ r0: 0, c0: 0, r1: 3, c1: 2 })
    h.up()
    h.over(5, 5)
    h.move()
    expect(h.sel.range()).toMatchObject({ r1: 3, c1: 2 })
  })

  it('on a column header selects the column and reports it', () => {
    const onSelect = vi.fn()
    const h = setup({}, { onSelect })
    h.hit({ kind: 'colHeader', col: 1 })
    h.down()
    expect(h.sel.mode).toBe('col')
    expect(onSelect).toHaveBeenCalledWith('B:B')
  })

  it('on the corner selects everything', () => {
    const h = setup()
    h.hit({ kind: 'corner' })
    h.down()
    expect(h.sel.range()).toMatchObject({ r0: 0, c0: 0, r1: 99, c1: 25, mode: 'all' })
  })

  it('while a formula is focused, picks instead of selecting', () => {
    const h = setup()
    const input = document.createElement('input')
    h.picker.target.mockReturnValue(input)
    h.hit({ kind: 'cell', r: 4, c: 1 })
    h.down({ shiftKey: true })
    expect(h.picker.pickCell).toHaveBeenCalledWith(input, 4, 1, true)
    expect(h.editor.commit).not.toHaveBeenCalled()
    expect(h.sel.anchor).toEqual({ r: 0, c: 0 })
  })

  it('picking the cell being edited does nothing', () => {
    const h = setup()
    h.picker.target.mockReturnValue(document.createElement('input'))
    h.editor.isOpen.mockReturnValue(true)
    h.hit({ kind: 'cell', r: 0, c: 0 })
    h.down()
    expect(h.picker.pickCell).not.toHaveBeenCalled()
  })

  it('right-click inside the selection keeps the range', () => {
    const h = setup()
    h.sel.moveTo(0, 0)
    h.sel.extendTo(3, 3)
    h.over(2, 2)
    h.hit({ kind: 'cell', r: 2, c: 2 })
    h.down({ button: 2 })
    expect(h.sel.range()).toMatchObject({ r1: 3, c1: 3 })
    expect(h.mouse.preMousedownSel()).toMatchObject({ r1: 3, c1: 3 })
  })
})

describe('resize', () => {
  it('dragging a column edge sets the width, divided by zoom, and reports the end', () => {
    const onResizeEnd = vi.fn()
    const h = setup({ getZoom: () => 2 }, { onResizeEnd })
    h.hit({ kind: 'colResize', col: 2 })
    h.down({ clientX: 300 })
    h.docMove({ clientX: 340 })
    expect(h.widths[2]).toBe(120)
    h.up()
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
  })

  it('resizes every selected column when the edge is inside the selection', () => {
    const h = setup()
    h.sel.mode = 'col'
    h.sel.anchor = { r: 0, c: 1 }
    h.sel.head = { r: 99, c: 3 }
    h.hit({ kind: 'colResize', col: 2 })
    h.down({ clientX: 0 })
    h.docMove({ clientX: 50 })
    expect(h.opts.setColWidths).toHaveBeenLastCalledWith([1, 2, 3], 150)
  })
})

describe('fill handle', () => {
  it('dragging past the threshold and releasing reports the fill', () => {
    const onFill = vi.fn()
    const h = setup({}, { onFill })
    h.hit({ kind: 'fillHandle' })
    h.down({ clientX: 0, clientY: 0 })
    h.over(4, 0)
    h.move({ clientX: 2, clientY: 2 }) // jitter: ignored
    expect(h.sel.range().r1).toBe(0)
    h.move({ clientX: 0, clientY: 40 })
    h.up()
    expect(onFill).toHaveBeenCalledWith(
      { r0: 0, c0: 0, r1: 0, c1: 0 },
      expect.objectContaining({ r1: 4 }),
      { withModifier: false },
    )
  })
})

describe('column move', () => {
  it('drags a header past the threshold and reports the drop column', () => {
    const onColMove = vi.fn()
    const h = setup({}, { onColMove })
    h.hit({ kind: 'colHeader', col: 1 })
    h.down({ clientX: 0, clientY: 0 })
    h.docMove({ clientX: 30, clientY: 0 })
    expect(h.mouse.colDrag()).toMatchObject({ fromCol: 1, moved: true, insertCol: 4 })
    h.up()
    expect(onColMove).toHaveBeenCalledWith(1, 4, 1)
    expect(h.mouse.colDrag()).toBeNull()
  })

  it('is not armed for viewers', () => {
    const h = setup({ canEdit: () => false }, { onColMove: vi.fn() })
    h.hit({ kind: 'colHeader', col: 1 })
    h.down()
    expect(h.mouse.colDrag()).toBeNull()
  })
})

describe('double-click', () => {
  it('on a cell opens the editor with its formula', () => {
    const h = setup()
    h.hit({ kind: 'cell', r: 1, c: 1 })
    h.dbl()
    expect(h.editor.open).toHaveBeenCalledWith('=A1*2', 'edit')
  })

  it('on a header or resize edge auto-fits', () => {
    const h = setup()
    h.hit({ kind: 'colHeader', col: 3 })
    h.dbl()
    h.hit({ kind: 'rowResize', row: 5 })
    h.dbl()
    expect(h.opts.autoFitCol).toHaveBeenCalledWith(3)
    expect(h.opts.autoFitRow).toHaveBeenCalledWith(5)
  })

  it('lets the host drill into a pivot instead of editing', () => {
    const h = setup({}, { onPivotDrill: () => true })
    h.hit({ kind: 'cell', r: 1, c: 1 })
    h.dbl()
    expect(h.editor.open).not.toHaveBeenCalled()
  })

  it('does nothing for viewers', () => {
    const h = setup({ canEdit: () => false })
    h.hit({ kind: 'cell', r: 1, c: 1 })
    h.dbl()
    expect(h.editor.open).not.toHaveBeenCalled()
  })
})

describe('list dropdown', () => {
  it('opens on release when the click stayed put', () => {
    const onDropdownClick = vi.fn()
    const rule = { type: 'list' }
    const h = setup({ validationAt: () => rule }, { onDropdownClick })
    h.hit({ kind: 'cell', r: 1, c: 2 })
    h.over(1, 2)
    h.down({ clientX: 10, clientY: 10 })
    h.up({ clientX: 11, clientY: 10 })
    expect(onDropdownClick).toHaveBeenCalledWith('C2', rule, { x: 200, y: 40, w: 100 })
  })

  it('does not open after a drag', () => {
    const onDropdownClick = vi.fn()
    const h = setup({ validationAt: () => ({ type: 'list' }) }, { onDropdownClick })
    h.hit({ kind: 'cell', r: 1, c: 2 })
    h.over(1, 2)
    h.down({ clientX: 10, clientY: 10 })
    h.up({ clientX: 60, clientY: 10 })
    expect(onDropdownClick).not.toHaveBeenCalled()
  })
})

describe('wheel', () => {
  it('scrolls by the delta divided by zoom', () => {
    const h = setup({ getZoom: () => 2 })
    h.canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 10, deltaY: 100, cancelable: true }))
    expect(h.opts.scrollBy).toHaveBeenCalledWith(5, 50)
  })
})
