import { beforeEach, describe, expect, it } from 'vitest'

import { colLabel } from '../utils/cells.js'
import { createClipboard } from './clipboard.js'

// The clipboard's `cells` port over a plain {cellId: input} store. Inputs
// display as themselves.
function makeSheet(initial = {}) {
  const store = { ...initial }
  const grid = ({ r0, c0, r1, c1 }) => {
    const rows = []
    for (let r = r0; r <= r1; r++) {
      const row = []
      for (let c = c0; c <= c1; c++) row.push(store[colLabel(c) + (r + 1)] ?? '')
      rows.push(row)
    }
    return rows
  }
  return {
    read: async (_sn, rect) => ({ inputs: grid(rect), displays: grid(rect) }),
    write: (_sn, map) => Object.assign(store, map),
    getCell: (id) => store[id] ?? '',
    _store: () => store,
  }
}

describe('clipboard — copy/paste a pivot', () => {
  let sheet
  const pivotBlob = {
    sourceSheet: 'Src',
    sourceRange: 'A1:B9',
    rows: ['R'],
    cols: [],
    values: [{ field: 'V', agg: 'sum' }],
  }

  beforeEach(() => {
    sheet = makeSheet({ A1: 'H1', A2: 'a', B2: 1 })
  })

  it('captures the pivot blob when the copied range overlaps a pivot', async () => {
    const cb = createClipboard({
      cells: sheet,
      getCurrentSheet: () => 'Sheet1',
      getPivotAt: () => pivotBlob,
    })
    await cb.copy({ r0: 0, c0: 0, r1: 2, c1: 1 })
    expect(cb.getPivotBlob()).toEqual(pivotBlob)
  })

  it('a full paste mints a new pivot at the anchor instead of writing cells', async () => {
    const calls = []
    const cb = createClipboard({
      cells: sheet,
      getCurrentSheet: () => 'Sheet1',
      getPivotAt: () => pivotBlob,
      createPivotFromPaste: (blob, anchorId, sn) => {
        calls.push({ blob, anchorId, sn })
      },
    })
    await cb.copy({ r0: 0, c0: 0, r1: 2, c1: 1 })
    await cb.paste('H1', null, 'all')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ blob: pivotBlob, anchorId: 'H1' })
    expect(sheet.getCell('H1')).toBe('') // no static cells written
  })

  it('paste-special (values) ignores the blob and pastes dead cells', async () => {
    const calls = []
    const cb = createClipboard({
      cells: sheet,
      getCurrentSheet: () => 'Sheet1',
      getPivotAt: () => pivotBlob,
      createPivotFromPaste: (...a) => {
        calls.push(a)
      },
    })
    await cb.copy({ r0: 0, c0: 0, r1: 2, c1: 1 })
    await cb.paste('H1', null, 'values')
    expect(calls).toHaveLength(0) // not treated as a pivot
    expect(sheet.getCell('H1')).toBe('H1') // static value pasted
  })

  it('clears the captured blob on clear()', async () => {
    const cb = createClipboard({
      cells: sheet,
      getCurrentSheet: () => 'Sheet1',
      getPivotAt: () => pivotBlob,
    })
    await cb.copy({ r0: 0, c0: 0, r1: 2, c1: 1 })
    cb.clear()
    expect(cb.getPivotBlob()).toBeNull()
  })
})

describe('clipboard — destination-aware paste', () => {
  let sheet, cb
  beforeEach(() => {
    sheet = makeSheet({ A1: 'X' })
    cb = createClipboard({ cells: sheet, getCurrentSheet: () => 'Sheet1' })
  })

  it('1×1 source pasted into a multi-cell selection fills every dest cell', async () => {
    await cb.copy({ r0: 0, c0: 0, r1: 0, c1: 0 })
    await cb.paste('B1', null, 'all', { r0: 0, c0: 1, r1: 0, c1: 3 }) // B1:D1
    expect(sheet.getCell('B1')).toBe('X')
    expect(sheet.getCell('C1')).toBe('X')
    expect(sheet.getCell('D1')).toBe('X')
  })

  it('1×1 source into a multi-row + multi-col selection tiles fully', async () => {
    await cb.copy({ r0: 0, c0: 0, r1: 0, c1: 0 })
    await cb.paste('B2', null, 'all', { r0: 1, c0: 1, r1: 2, c1: 2 }) // B2:C3
    expect(sheet.getCell('B2')).toBe('X')
    expect(sheet.getCell('C2')).toBe('X')
    expect(sheet.getCell('B3')).toBe('X')
    expect(sheet.getCell('C3')).toBe('X')
  })

  it('multi-cell source tiles into a destination that is an integer multiple', async () => {
    sheet = makeSheet({ A1: '1', B1: '2' })
    cb = createClipboard({ cells: sheet, getCurrentSheet: () => 'Sheet1' })
    await cb.copy({ r0: 0, c0: 0, r1: 0, c1: 1 }) // A1:B1 = [1, 2]
    await cb.paste('A2', null, 'all', { r0: 1, c0: 0, r1: 1, c1: 3 }) // A2:D2
    expect(sheet.getCell('A2')).toBe('1')
    expect(sheet.getCell('B2')).toBe('2')
    expect(sheet.getCell('C2')).toBe('1')
    expect(sheet.getCell('D2')).toBe('2')
  })

  it('non-tileable destination falls back to anchor paste', async () => {
    sheet = makeSheet({ A1: '1', B1: '2' })
    cb = createClipboard({ cells: sheet, getCurrentSheet: () => 'Sheet1' })
    await cb.copy({ r0: 0, c0: 0, r1: 0, c1: 1 }) // 2 cols
    await cb.paste('A2', null, 'all', { r0: 1, c0: 0, r1: 1, c1: 2 }) // 3 cols → not divisible
    expect(sheet.getCell('A2')).toBe('1')
    expect(sheet.getCell('B2')).toBe('2')
    expect(sheet.getCell('C2')).toBe('') // untouched
  })

  it('single-cell destination behaves the same as no destSel', async () => {
    await cb.copy({ r0: 0, c0: 0, r1: 0, c1: 0 })
    await cb.paste('B1', null, 'all', { r0: 0, c0: 1, r1: 0, c1: 1 })
    expect(sheet.getCell('B1')).toBe('X')
    expect(sheet.getCell('C1')).toBe('')
  })

  it('pasteFromText tiles a single token across a multi-cell destination', async () => {
    cb.pasteFromText('hello', 'B1', null, { r0: 0, c0: 1, r1: 0, c1: 3 })
    expect(sheet.getCell('B1')).toBe('hello')
    expect(sheet.getCell('C1')).toBe('hello')
    expect(sheet.getCell('D1')).toBe('hello')
  })

  it('pasteFromText with a single token but single-cell dest writes one cell', async () => {
    cb.pasteFromText('hi', 'B1', null, { r0: 0, c0: 1, r1: 0, c1: 1 })
    expect(sheet.getCell('B1')).toBe('hi')
    expect(sheet.getCell('C1')).toBe('')
  })
})

describe('clipboard — pasteFromHTML (external table)', () => {
  let sheet, cb
  beforeEach(() => {
    sheet = makeSheet({})
    cb = createClipboard({ cells: sheet, getCurrentSheet: () => 'Sheet1' })
  })

  it('parses a <table> into rows and columns at the anchor', async () => {
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>'
    expect(cb.pasteFromHTML(html, 'A1', null)).toBe(true)
    expect(sheet.getCell('A1')).toBe('a')
    expect(sheet.getCell('B1')).toBe('b')
    expect(sheet.getCell('A2')).toBe('c')
    expect(sheet.getCell('B2')).toBe('d')
  })

  it('handles th headers and collapses whitespace in cells', async () => {
    const html =
      '<table><tr><th>Name</th><th>MRR</th></tr>' +
      '<tr><td>webdev@lush\n.co.uk</td><td>9,415</td></tr></table>'
    cb.pasteFromHTML(html, 'A1', null)
    expect(sheet.getCell('A1')).toBe('Name')
    expect(sheet.getCell('B1')).toBe('MRR')
    expect(sheet.getCell('A2')).toBe('webdev@lush .co.uk')
    expect(sheet.getCell('B2')).toBe('9,415')
  })

  it('pads blanks for colspan so columns stay aligned', async () => {
    const html =
      '<table><tr><td colspan="2">June 2026</td><td>x</td></tr>' +
      '<tr><td>1</td><td>2</td><td>3</td></tr></table>'
    cb.pasteFromHTML(html, 'A1', null)
    expect(sheet.getCell('A1')).toBe('June 2026')
    expect(sheet.getCell('B1')).toBe('')
    expect(sheet.getCell('C1')).toBe('x')
    expect(sheet.getCell('C2')).toBe('3')
  })

  it('returns false when the HTML has no table', async () => {
    expect(cb.pasteFromHTML('<p>hello world</p>', 'A1', null)).toBe(false)
    expect(sheet.getCell('A1')).toBe('')
  })

  it('ignores rows/cells of a table nested inside a cell (no row bleed)', async () => {
    // Web-page clipboard HTML often embeds a <table> inside a <td>. Only the
    // outer table's rows should become grid rows; the nested table collapses
    // into its parent cell's text.
    const html =
      '<table><tr><td>outer</td>' +
      '<td><table><tr><td>inner1</td></tr><tr><td>inner2</td></tr></table></td></tr>' +
      '<tr><td>next</td><td>row</td></tr></table>'
    cb.pasteFromHTML(html, 'A1', null)
    expect(sheet.getCell('A1')).toBe('outer')
    expect(sheet.getCell('B1')).toBe('inner1inner2') // nested text, one cell
    expect(sheet.getCell('A2')).toBe('next') // outer row 2, not bled
    expect(sheet.getCell('B2')).toBe('row')
    expect(sheet.getCell('A3')).toBe('') // no phantom rows
  })
})

describe('clipboard — cut clears the source but not overlapping dest cells', () => {
  it('cut C2:C7 then paste at C3:C8 shifts the column down by one row', async () => {
    // Repro for the "all values vanish, only the last survives" bug: the
    // cut-clear pass used to wipe the whole source range, including cells
    // that had just received the pasted content.
    const sheet = makeSheet({ C2: '1', C3: '2', C4: '3', C5: '4', C6: '5', C7: '6' })
    const cb = createClipboard({ cells: sheet, getCurrentSheet: () => 'Sheet1' })
    await cb.cut({ r0: 1, c0: 2, r1: 6, c1: 2 }) // C2:C7
    await cb.paste('C3', null, 'all', { r0: 2, c0: 2, r1: 7, c1: 2 }) // C3:C8
    expect(sheet.getCell('C2')).toBe('') // source-only cell vacated
    expect(sheet.getCell('C3')).toBe('1')
    expect(sheet.getCell('C4')).toBe('2')
    expect(sheet.getCell('C5')).toBe('3')
    expect(sheet.getCell('C6')).toBe('4')
    expect(sheet.getCell('C7')).toBe('5')
    expect(sheet.getCell('C8')).toBe('6')
  })

  it('cut still fully vacates the source when there is no overlap', async () => {
    const sheet = makeSheet({ A1: '1', A2: '2' })
    const cb = createClipboard({ cells: sheet, getCurrentSheet: () => 'Sheet1' })
    await cb.cut({ r0: 0, c0: 0, r1: 1, c1: 0 }) // A1:A2
    await cb.paste('C1', null, 'all') // C1:C2 — no overlap
    expect(sheet.getCell('A1')).toBe('')
    expect(sheet.getCell('A2')).toBe('')
    expect(sheet.getCell('C1')).toBe('1')
    expect(sheet.getCell('C2')).toBe('2')
  })
})

describe('clipboard — measure external paste extent (undo-capture bounds)', () => {
  // Repro for the live bug: a multi-row text file pasted into a single clicked
  // cell wrote every row, but undo only reverted the anchor because the editor
  // sized its before/after capture to the clicked cell alone. The measure
  // helpers report the true output rect so the capture covers the whole block.
  let sheet, cb
  beforeEach(() => {
    sheet = makeSheet({})
    cb = createClipboard({ cells: sheet, getCurrentSheet: () => 'Sheet1' })
  })

  it('measureTextPaste covers the whole block for a single-cell selection', async () => {
    const text = 'a\tb\tc\n1\t2\t3\n4\t5\t6' // 3 rows × 3 cols
    const rect = cb.measureTextPaste(text, 'A1', { r0: 0, c0: 0, r1: 0, c1: 0 })
    expect(rect).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 })
  })

  it('measureTextPaste matches the cells the write actually touches', async () => {
    const text = 'a\tb\tc\n1\t2\t3\n4\t5\t6'
    const rect = cb.measureTextPaste(text, 'C3', null)
    cb.pasteFromText(text, 'C3', null, null)
    // Every written cell falls inside the measured rect, and its corners are
    // written — the capture neither under- nor over-covers.
    expect(rect).toEqual({ r0: 2, c0: 2, r1: 4, c1: 4 })
    expect(sheet.getCell('C3')).toBe('a') // top-left
    expect(sheet.getCell('E5')).toBe('6') // bottom-right
  })

  it('measureTextPaste honours a tiled destination (rect === destSel)', async () => {
    const rect = cb.measureTextPaste('x', 'B1', { r0: 0, c0: 1, r1: 0, c1: 3 })
    expect(rect).toEqual({ r0: 0, c0: 1, r1: 0, c1: 3 })
  })

  it('measureTextPaste returns null for empty/blank text', async () => {
    expect(cb.measureTextPaste('', 'A1', null)).toBeNull()
    expect(cb.measureTextPaste('   ', 'A1', null)).toBeNull()
  })

  it('measureHTMLPaste reports the table block; null when there is no table', async () => {
    const html =
      '<table>' +
      '<tr><td>a</td><td>b</td><td>c</td></tr>' +
      '<tr><td>1</td><td>2</td><td>3</td></tr></table>'
    expect(cb.measureHTMLPaste(html, 'A1', { r0: 0, c0: 0, r1: 0, c1: 0 })).toEqual({
      r0: 0,
      c0: 0,
      r1: 1,
      c1: 2,
    })
    expect(cb.measureHTMLPaste('<p>no table</p>', 'A1', null)).toBeNull()
  })
})

describe('clipboard — reading the source', () => {
  it('a paste right after a copy waits for the source read', async () => {
    const sheet = makeSheet({ A1: 'x' })
    let release
    const gate = new Promise((r) => (release = r))
    const read = sheet.read
    sheet.read = async (...a) => {
      await gate
      return read(...a)
    }
    const cb = createClipboard({ cells: sheet, getCurrentSheet: () => 'Sheet1' })
    void cb.copy({ r0: 0, c0: 0, r1: 0, c1: 0 })
    expect(cb.hasData()).toBe(true) // known at once, before the read returns
    const pasted = cb.paste('B1', null, 'all')
    release()
    await pasted
    expect(sheet.getCell('B1')).toBe('x')
  })

  it('a cut pasted on another sheet clears the source sheet', async () => {
    const writes = []
    const cells = {
      read: async () => ({ inputs: [['1']], displays: [['1']] }),
      write: (sn, map) => writes.push([sn, map]),
    }
    let sn = 'Sheet1'
    const cb = createClipboard({ cells, getCurrentSheet: () => sn })
    await cb.cut({ r0: 0, c0: 0, r1: 0, c1: 0 })
    sn = 'Sheet2'
    await cb.paste('A1', null, 'all')
    expect(writes).toEqual([
      ['Sheet2', { A1: '1' }],
      ['Sheet1', { A1: '' }],
    ])
  })

  it('paste values writes what a formula showed when copied', async () => {
    const written = {}
    const cells = {
      read: async () => ({ inputs: [['=1+1']], displays: [['2']] }),
      write: (_sn, map) => Object.assign(written, map),
    }
    const cb = createClipboard({ cells, getCurrentSheet: () => 'Sheet1' })
    await cb.copy({ r0: 0, c0: 0, r1: 0, c1: 0 })
    await cb.paste('B1', null, 'values')
    expect(written).toEqual({ B1: '2' })
  })
})
