import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createViewModel, type ViewSnapshot } from '../core/view-model'
import { agentAnswer, valuesAnswer } from './agent'
import { addSheet, axis, cellKey, roots } from './schema'
import { inputs, openTab, type, type Tab } from './test-tabs'

// Tabs run IronCalc: a few seconds on CI runners
const TIMEOUT = 30_000
// The write session's client id, as the server issues it
const CLIENT = 4242
// The kinds suite/sheets/content/__init__.py lets a row hold: GC, Deleted, Type, Any
const SERVER_KINDS = [0, 1, 7, 8]

type Answer = ReturnType<typeof agentAnswer>

function ask(doc: Y.Doc | null, header: Parameters<typeof agentAnswer>[0]): NonNullable<Answer> {
  return agentAnswer(header, doc ? [Y.encodeStateAsUpdate(doc)] : [new Uint8Array()])!
}

function write(doc: Y.Doc | null, op: unknown) {
  // SAFETY: a write header answers {update} or {refused}
  return ask(doc, { write: op, client: CLIENT }) as { update?: string | null; refused?: unknown }
}

function updateOf(answer: { update?: string | null }): Uint8Array {
  if (!answer.update) throw new Error(`no update: ${JSON.stringify(answer)}`)
  return Buffer.from(answer.update, 'base64')
}

// The doc after the server applies the write's update
function written(doc: Y.Doc | null, op: unknown): Y.Doc {
  const after = new Y.Doc()
  if (doc) Y.applyUpdate(after, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(after, updateOf(write(doc, op)))
  return after
}

function read(doc: Y.Doc) {
  // SAFETY: a read header answers {sheets}, and these docs are under the read cap
  return (ask(doc, { read: true }) as { sheets: { name: string; rows: string[][] }[] }).sheets
}

async function received(tab: Tab, update: Uint8Array): Promise<void> {
  tab.glue.receive(update)
  await tab.glue.settled()
}

describe('agent writes', () => {
  it(
    'answer one update from the session client, of kinds the server takes',
    async () => {
      const tab = await openTab('A')
      await type(tab, 'Sheet1', 'A1', 'gone')
      const ops = [
        {
          kind: 'cells',
          sheet: 'Sheet1',
          start: 'B2',
          rows: [
            ['x', 3, true],
            [null, '=B2'],
          ],
        },
        { kind: 'cells', sheet: 'Sheet1', start: 'C9000', rows: [['far']] },
        { kind: 'cells', sheet: 'Sheet1', start: 'A1', rows: [['']] },
        { kind: 'rows', sheet: 'Sheet1', rows: [['a'], ['b']] },
        { kind: 'sheets', sheets: [{ name: 'Notes', rows: [['n']] }] },
        { kind: 'heights', sheet: 'Sheet1', start: 2, heights: [60, null, 120] },
      ]
      for (const op of ops) {
        const { structs } = Y.decodeUpdate(updateOf(write(tab.doc, op)))
        for (const struct of structs) {
          expect(struct.id.client).toBe(CLIENT)
          const kind = struct instanceof Y.Item ? struct.content.getRef() : 0
          expect(SERVER_KINDS).toContain(kind)
          // The only shared type the server takes is a Y.Array
          if (struct instanceof Y.Item && struct.content instanceof Y.ContentType)
            expect(struct.content.type).toBeInstanceOf(Y.Array)
        }
      }
    },
    TIMEOUT,
  )

  it(
    'show in an open tab where they were written',
    async () => {
      const tab = await openTab('A')
      await received(
        tab,
        updateOf(
          write(tab.doc, {
            kind: 'cells',
            sheet: 'Sheet1',
            start: 'B5000',
            rows: [['far', '=1+1']],
          }),
        ),
      )
      expect(await inputs(tab)).toEqual({ 'Sheet1!B5000': 'far', 'Sheet1!C5000': '=1+1' })
    },
    TIMEOUT,
  )

  it(
    'grow the same row and column ids a tab typing there grows',
    async () => {
      const start = await openTab('A')
      await type(start, 'Sheet1', 'A3', 'near')
      const tab = await openTab('B', start.doc)
      await type(tab, 'Sheet1', 'D5000', 'far')

      const agent = written(start.doc, {
        kind: 'cells',
        sheet: 'Sheet1',
        start: 'D5000',
        rows: [['far']],
      })
      for (const root of ['rows', 'cols', 'inputs', 'tails'] as const)
        expect(roots(agent)[root].toJSON()).toEqual(roots(tab.doc)[root].toJSON())
    },
    TIMEOUT,
  )

  it(
    'leave a null cell, clear an empty string, and touch nothing else',
    async () => {
      const tab = await openTab('A')
      await type(tab, 'Sheet1', 'A1', 'kept')
      await type(tab, 'Sheet1', 'B1', 'cleared')
      tab.stores.formats.applyToRange(['A1', 'B1'], { bold: true }, 'Sheet1')
      tab.stores.merge.merge(4, 0, 4, 1, 'Sheet1')
      await tab.glue.commit()

      const after = written(tab.doc, {
        kind: 'cells',
        sheet: 'Sheet1',
        start: 'A1',
        rows: [[null, '']],
      })
      const other = await openTab('B', after)
      expect(await inputs(other)).toEqual({ 'Sheet1!A1': 'kept' })
      const typed = ['inputs', 'rows', 'cols', 'tails']
      const untyped = (doc: Y.Doc) =>
        Object.entries(roots(doc))
          .filter(([name]) => !typed.includes(name))
          .map(([name, root]) => [name, root.toJSON()])
      expect(untyped(after)).toEqual(untyped(tab.doc))
    },
    TIMEOUT,
  )

  it(
    'type numbers and booleans as a tab types them',
    async () => {
      const tab = await openTab('A')
      const after = written(tab.doc, {
        kind: 'cells',
        sheet: 'sheet1',
        start: 'a1',
        rows: [[3, -2.5, true, false]],
      })
      expect(await inputs(await openTab('B', after))).toEqual({
        'Sheet1!A1': '3',
        'Sheet1!B1': '-2.5',
        'Sheet1!C1': 'TRUE',
        'Sheet1!D1': 'FALSE',
      })
    },
    TIMEOUT,
  )

  it(
    'append rows below the last used row, each time they are sent',
    async () => {
      const tab = await openTab('A')
      await type(tab, 'Sheet1', 'C2', 'top')
      const op = { kind: 'rows', sheet: 'Sheet1', rows: [['a', 'b']] }
      const twice = written(written(tab.doc, op), op)
      expect(read(twice)[0]!.rows).toEqual([[], ['', '', 'top'], ['a', 'b'], ['a', 'b']])
    },
    TIMEOUT,
  )

  it('append to an empty sheet from A1', () => {
    const doc = written(null, { kind: 'sheets', sheets: [{ name: 'Log' }] })
    const after = written(doc, { kind: 'rows', sheet: 'Log', rows: [['first']] })
    expect(read(after)).toEqual([{ name: 'Log', rows: [['first']] }])
  })

  it(
    'make a new spreadsheet a tab opens, its sheets in order',
    async () => {
      const doc = written(null, {
        kind: 'sheets',
        sheets: [
          {
            name: 'Budget',
            rows: [
              ['Rent', 1200],
              [null, '=B1*2'],
            ],
          },
          { name: 'Notes' },
        ],
      })
      const tab = await openTab('A', doc)
      expect(tab.client.sheets).toEqual(['Budget', 'Notes'])
      expect(await inputs(tab)).toEqual({
        'Budget!A1': 'Rent',
        'Budget!B1': '1200',
        'Budget!B2': '=B1*2',
      })
    },
    TIMEOUT,
  )

  it(
    'answer no update when they change nothing, as a retried read-back write',
    async () => {
      const tab = await openTab('A')
      await type(tab, 'Sheet1', 'A1', 'Rent')
      await type(tab, 'Sheet1', 'C3', '=SUM(A1:A2)')
      await type(tab, 'Sheet1', 'B7000', 'far')
      const [sheet] = read(tab.doc)
      expect(sheet!.rows.slice(0, 3)).toEqual([['Rent'], [], ['', '', '=SUM(A1:A2)']])
      expect(sheet!.rows).toHaveLength(7000)
      expect(sheet!.rows[6999]).toEqual(['', 'far'])

      const again = { kind: 'cells', sheet: 'Sheet1', start: 'A1', rows: sheet!.rows }
      expect(write(tab.doc, again)).toEqual({ update: null })
    },
    TIMEOUT,
  )
})

describe('agent row heights', () => {
  const heights = (start: unknown, list: unknown) => ({
    kind: 'heights',
    sheet: 'Sheet1',
    start,
    heights: list,
  })
  // What the tab's view store holds for the sheet, as its view model saves it
  const view = (tab: Tab) => {
    // SAFETY: the glue restores each sheet's view slice into the store as a ViewSnapshot
    const snaps = tab.stores.view.snapshot() as Record<string, ViewSnapshot | undefined>
    return snaps.Sheet1
  }
  // What a tab's drag on each row to its height leaves (canvas/index.ts setRowHeights)
  function dragged(slice: Partial<ViewSnapshot>, sizes: [row: number, height: number][]) {
    const vm = createViewModel()
    vm.restore(slice)
    for (const [row, height] of sizes) {
      vm.setRowHeight(row, height)
      vm.setRowManual(row, true)
    }
    const { zoom: _, ...shared } = vm.serialize()
    return shared
  }
  // A tab's view, its rows sized every way and a hidden row among those set
  function saved() {
    const vm = createViewModel()
    vm.setColWidth(2, 200)
    vm.setFreeze(1, 1)
    vm.setHiddenRows([4])
    vm.setHiddenCols([6])
    vm.setTotalRows(1500)
    vm.setRowHeight(7, 90)
    vm.setRowManual(7, true)
    // Fitted to its text, so a tab may refit it
    vm.setRowHeight(1, 44)
    const { zoom: _, ...shared } = vm.serialize()
    return shared
  }

  it(
    "size each row as a tab's drag does, in an open tab, the rest of its view kept",
    async () => {
      const tab = await openTab('A')
      await type(tab, 'Sheet1', 'A1', 'kept')
      tab.stores.formats.applyToRange(['A1'], { bold: true }, 'Sheet1')
      tab.stores.merge.merge(9, 0, 9, 1, 'Sheet1')
      tab.stores.view.restore({ Sheet1: saved() })
      await tab.glue.commit()
      const before = Y.encodeStateAsUpdate(tab.doc)
      const op = heights(2, [60, 60, null, 120])

      const after = written(tab.doc, op)
      await received(tab, updateOf(write(tab.doc, op)))
      const slice = view(tab)!
      expect(slice).toEqual(
        dragged(saved(), [
          [1, 60],
          [2, 60],
          [4, 120],
        ]),
      )
      const vm = createViewModel()
      vm.restore(slice)
      expect([0, 1, 2, 3, 4, 7].map((r) => vm.rowHeight(r))).toEqual([28, 60, 60, 28, 120, 90])
      expect(vm.manualRows).toEqual(new Set([7, 1, 2, 4]))
      expect(vm.hiddenRows).toEqual(new Set([4]))
      const { rowH: _r, manualRows: _m, ...rest } = slice
      const { rowH: _sr, manualRows: _sm, ...savedRest } = saved()
      expect(rest).toEqual(savedRest)
      // Cells, formats, merges and every other root as they were
      const was = new Y.Doc()
      Y.applyUpdate(was, before)
      const others = (doc: Y.Doc) =>
        Object.entries(roots(doc))
          .filter(([name]) => name !== 'sheetState')
          .map(([name, root]) => [name, root.toJSON()])
      expect(others(after)).toEqual(others(was))
    },
    TIMEOUT,
  )

  it(
    "size a row on a sheet with no view saved as a tab's first drag there leaves it",
    async () => {
      const tab = await openTab('A')
      expect(view(tab)).toBeUndefined()
      await received(tab, updateOf(write(tab.doc, heights(3, [40]))))
      const loaded = createViewModel()
      loaded.restore(view(tab))
      const { zoom: _, ...shared } = loaded.serialize()
      expect(shared).toEqual(dragged({}, [[2, 40]]))
    },
    TIMEOUT,
  )

  it(
    'keep every height of a view saved before manual rows, as a tab loads it',
    async () => {
      const tab = await openTab('A')
      tab.stores.view.restore({ Sheet1: { rowH: { 0: 50 } } })
      await tab.glue.commit()
      await received(tab, updateOf(write(tab.doc, heights(3, [40]))))
      expect(view(tab)).toEqual({ rowH: { 0: 50, 2: 40 }, manualRows: [0, 2] })
    },
    TIMEOUT,
  )

  it(
    'answer no update for heights a tab already has, or all null',
    async () => {
      const tab = await openTab('A')
      tab.stores.view.restore({ Sheet1: saved() })
      await tab.glue.commit()
      expect(write(tab.doc, heights(8, [90]))).toEqual({ update: null })
      expect(write(tab.doc, heights(1, [null, null]))).toEqual({ update: null })
      // Row 2 holds 44 fitted to its text: the same height still sizes it by hand
      await received(tab, updateOf(write(tab.doc, heights(2, [44]))))
      expect(view(tab)!.manualRows).toEqual([7, 1])
    },
    TIMEOUT,
  )

  it(
    'take fractional heights from 16 to 400, to the last row, on a protected sheet',
    async () => {
      const tab = await openTab('A')
      tab.stores.protection.setSheetLocked(true, 'Sheet1')
      await tab.glue.commit()
      await received(tab, updateOf(write(tab.doc, heights(1_048_575, [16, 400]))))
      await received(tab, updateOf(write(tab.doc, heights(1, [27.5]))))
      expect(view(tab)!.rowH).toEqual({ 0: 27.5, 1_048_574: 16, 1_048_575: 400 })
    },
    TIMEOUT,
  )

  it.each([
    ['no start', heights(undefined, [60]), 'row'],
    ['start 0', heights(0, [60]), 'row'],
    ['a fractional start', heights(1.5, [60]), 'row'],
    ['a start as text', heights('2', [60]), 'row'],
    ['a start past the last row', heights(1_048_577, [60]), 'row'],
    ['no heights', heights(1, undefined), 'heights'],
    ['heights that are no list', heights(1, 60), 'heights'],
    ['no height in the list', heights(1, []), 'heights'],
    ['more than 10,000 heights, nulls counted', heights(1, Array(10_001).fill(null)), 'heights'],
    ['a height under 16', heights(1, [15.9]), 'height'],
    ['a height over 400', heights(1, [400.5]), 'height'],
    ['a height as text', heights(1, ['60']), 'height'],
    ['a height as a boolean', heights(1, [true]), 'height'],
    ['heights past the last row', heights(1_048_576, [60, 60]), 'past_grid'],
  ])(
    'refused for %s, naming the sheet',
    async (_, op, reason) => {
      const tab = await openTab('A')
      expect(write(tab.doc, op)).toEqual({ refused: { reason, sheet: 'Sheet1' } })
    },
    TIMEOUT,
  )
})

describe('agent writes refused', () => {
  const cells = (start: string, rows: unknown) => ({ kind: 'cells', sheet: 'Sheet1', start, rows })
  const sheets = (...names: string[]) => ({
    kind: 'sheets',
    sheets: names.map((name) => ({ name })),
  })

  it.each([
    ['no sheets', { kind: 'sheets', sheets: [] }, { reason: 'no_sheets' }],
    ['a name with a slash', sheets('a/b'), { reason: 'name', sheet: 'a/b' }],
    ['an empty name', sheets(''), { reason: 'name', sheet: '' }],
    ['a 32-character name', sheets('x'.repeat(32)), { reason: 'name', sheet: 'x'.repeat(32) }],
    ['a taken name, whatever its case', sheets('SHEET1'), { reason: 'taken', sheet: 'SHEET1' }],
    ['one name twice', sheets('Two', 'two'), { reason: 'taken', sheet: 'two' }],
    [
      'no such sheet',
      { ...cells('A1', [['x']]), sheet: 'Nope' },
      { reason: 'no_sheet', sheet: 'Nope' },
    ],
    ['a start that is no cell', cells('A0', [['x']]), { reason: 'start', sheet: 'Sheet1' }],
    ['rows that are no list', cells('A1', 'x'), { reason: 'rows', sheet: 'Sheet1' }],
    ['a row that is no list', cells('A1', ['x']), { reason: 'rows', sheet: 'Sheet1' }],
    ['an object value', cells('A1', [[{}]]), { reason: 'value', sheet: 'Sheet1' }],
    [
      'an input past 32,767 characters',
      cells('B2', [['x'.repeat(32_768)]]),
      { reason: 'too_long', sheet: 'Sheet1', cell: 'B2' },
    ],
    [
      'more than 10,000 cells',
      cells(
        'A1',
        Array.from({ length: 101 }, () => Array<string>(100).fill('x')),
      ),
      { reason: 'too_many_cells' },
    ],
    [
      'a block past the last column',
      cells('XFD1', [['x', 'y']]),
      { reason: 'past_grid', sheet: 'Sheet1' },
    ],
    [
      'a block past the last row',
      cells('A1048576', [['x'], ['y']]),
      { reason: 'past_grid', sheet: 'Sheet1' },
    ],
  ])(
    'for %s, with no update',
    async (_, op, refused) => {
      const tab = await openTab('A')
      expect(write(tab.doc, op)).toEqual({ refused })
    },
    TIMEOUT,
  )

  it(
    'into a cell a merge covers, while null and its master pass',
    async () => {
      const tab = await openTab('A')
      tab.stores.merge.merge(0, 0, 0, 1, 'Sheet1')
      await tab.glue.commit()
      expect(write(tab.doc, cells('B1', [['x']]))).toEqual({
        refused: { reason: 'merged', sheet: 'Sheet1', cell: 'B1' },
      })
      expect(write(tab.doc, cells('A1', [['x', null]])).update).toBeTruthy()
    },
    TIMEOUT,
  )

  it(
    'into a protected cell, unless the value is already there',
    async () => {
      const tab = await openTab('A')
      await type(tab, 'Sheet1', 'A2', 'same')
      tab.stores.protection.addRange({ r0: 1, c0: 0, r1: 1, c1: 0 }, '', 'Sheet1')
      await tab.glue.commit()
      expect(write(tab.doc, cells('A2', [['other']]))).toEqual({
        refused: { reason: 'protected', sheet: 'Sheet1', cell: 'A2' },
      })
      expect(write(tab.doc, cells('A1', [[null], ['same']]))).toEqual({ update: null })
    },
    TIMEOUT,
  )

  it('past 200 sheets', () => {
    const doc = new Y.Doc()
    for (let n = 1; n <= 199; n++) addSheet(doc, `S${n}`)
    expect(write(doc, sheets('One', 'Two'))).toEqual({ refused: { reason: 'too_many_sheets' } })
  })
})

describe('agent reads', () => {
  it('give each sheet from A1 by the name a tab shows', () => {
    const doc = new Y.Doc()
    addSheet(doc, 'Same')
    addSheet(doc, 'same')
    const after = written(doc, { kind: 'cells', sheet: 'Same (2)', start: 'B2', rows: [['x']] })
    expect(read(after)).toEqual([
      { name: 'Same', rows: [] },
      { name: 'same (2)', rows: [[], ['', 'x']] },
    ])
  })

  it('refuse a grid past a million entries', () => {
    // 62 rows reaching the last column, XFD: 62 × 16,384 entries
    const doc = new Y.Doc()
    const id = addSheet(doc, 'Wide')
    const col = axis(doc, id, 'cols').ensure(16_383)
    for (let row = 0; row < 62; row++)
      roots(doc).inputs.set(cellKey(id, axis(doc, id, 'rows').ensure(row), col), 'x')
    expect(ask(doc, { read: true })).toEqual({ refused: { reason: 'too_large' } })
  })

  it('refuse a value on the last row', () => {
    const doc = new Y.Doc()
    const id = addSheet(doc, 'Tall')
    const row = axis(doc, id, 'rows').ensure(1_048_575)
    roots(doc).inputs.set(cellKey(id, row, axis(doc, id, 'cols').ensure(0)), 'x')
    expect(ask(doc, { read: true })).toEqual({ refused: { reason: 'too_large' } })
  })
})

describe('agent values read', () => {
  function values(doc: Y.Doc) {
    return valuesAnswer([Y.encodeStateAsUpdate(doc)])
  }

  it(
    'show a number format as a tab does, set from the toolbar or typed',
    async () => {
      const tab = await openTab('A')
      const cases: [string, string, string | null, string][] = [
        ['A1', '1200', 'currency:USD:2', '$1,200.00'],
        ['A2', '0.15', 'percentage:1', '15.0%'],
        ['A3', '46037', 'date:dmy', '15/01/2026'],
        ['A4', '15%', null, '15%'],
        ['A5', '$1.50', null, '$1.50'],
        ['A6', '2026-01-15', null, '2026-01-15'],
        ['A7', '=A1*2', 'currency:USD:2', '$2,400.00'],
        ['A8', '1200', 'number:in:0', '1,200'],
        ['A9', '46037.5', 'datetime:dmy_hm12', '15/01/2026, 12:00 PM'],
      ]
      for (const [id, input] of cases) await type(tab, 'Sheet1', id, input)
      for (const [id, , format] of cases)
        if (format) tab.stores.formats.applyToRange([id], { numberFormat: format }, 'Sheet1')
      await tab.glue.commit()

      expect(await values(tab.doc)).toEqual({
        sheets: [{ name: 'Sheet1', rows: cases.map(([, , , shown]) => [shown]) }],
      })
    },
    TIMEOUT,
  )

  it(
    'show a formula as its result and an error as a tab does, beside plain values',
    async () => {
      const doc = written(null, {
        kind: 'sheets',
        sheets: [
          {
            name: 'Data',
            rows: [
              ['Item', 2, '=B1*3', '=1/0'],
              ['=NOSUCH(1)', '=Notes!A1'],
            ],
          },
          { name: 'Notes', rows: [['n']] },
          { name: 'Empty' },
        ],
      })

      expect(await values(doc)).toEqual({
        sheets: [
          {
            name: 'Data',
            rows: [
              ['Item', '2', '6', '#DIV/0!'],
              ['#NAME?', 'n'],
            ],
          },
          { name: 'Notes', rows: [['n']] },
          { name: 'Empty', rows: [] },
        ],
      })
    },
    TIMEOUT,
  )

  it(
    'show a sparkline blank as a tab does, beside a formula',
    async () => {
      const doc = written(null, {
        kind: 'sheets',
        sheets: [{ name: 'Data', rows: [[1, 2, '=SPARKLINE(A1:B1)', '=A1+B1']] }],
      })

      expect(await values(doc)).toEqual({
        sheets: [{ name: 'Data', rows: [['1', '2', '', '3']] }],
      })
    },
    TIMEOUT,
  )

  it(
    'show each spilled cell at its place, and a spill with a typed cell in its way as #SPILL!',
    async () => {
      const doc = written(null, {
        kind: 'sheets',
        sheets: [
          { name: 'Down', rows: [['=SEQUENCE(3)']] },
          { name: 'Across', rows: [[], [null, '=SEQUENCE(1,3)']] },
          { name: 'Blocked', rows: [['=SEQUENCE(3)'], ['x']] },
        ],
      })

      expect(await values(doc)).toEqual({
        sheets: [
          { name: 'Down', rows: [['1'], ['2'], ['3']] },
          { name: 'Across', rows: [[], ['', '1', '2', '3']] },
          { name: 'Blocked', rows: [['#SPILL!'], ['x']] },
        ],
      })
    },
    TIMEOUT,
  )

  it(
    'show a toolbar number format on a spilled cell',
    async () => {
      const tab = await openTab('A')
      await type(tab, 'Sheet1', 'A1', '=SEQUENCE(3)*1200')
      tab.stores.formats.applyToRange(['A3'], { numberFormat: 'currency:USD:2' }, 'Sheet1')
      await tab.glue.commit()

      expect(await values(tab.doc)).toEqual({
        sheets: [{ name: 'Sheet1', rows: [['1200'], ['2400'], ['$3,600.00']] }],
      })
    },
    TIMEOUT,
  )

  it(
    'read a spill of 50,000 cells and refuse one more',
    async () => {
      const at = written(null, {
        kind: 'sheets',
        sheets: [{ name: 'S', rows: [['=SEQUENCE(50000)']] }],
      })
      const full = await values(at)
      expect('sheets' in full && full.sheets[0]!.rows[49999]).toEqual(['50000'])

      const over = written(null, {
        kind: 'sheets',
        sheets: [{ name: 'S', rows: [['=SEQUENCE(50001)']] }],
      })
      expect(await values(over)).toEqual({ refused: { reason: 'too_many_values' } })
    },
    TIMEOUT,
  )

  it(
    'count the 50,000 cells over all sheets',
    async () => {
      const at = written(null, {
        kind: 'sheets',
        sheets: [
          { name: 'One', rows: [['=SEQUENCE(25000)']] },
          { name: 'Two', rows: [['=SEQUENCE(25000)']] },
        ],
      })
      const full = await values(at)
      expect('sheets' in full && full.sheets[1]!.rows[24999]).toEqual(['25000'])

      const over = written(null, {
        kind: 'sheets',
        sheets: [
          { name: 'One', rows: [['=SEQUENCE(25000)']] },
          { name: 'Two', rows: [['=SEQUENCE(25001)']] },
        ],
      })
      expect(await values(over)).toEqual({ refused: { reason: 'too_many_values' } })
    },
    TIMEOUT,
  )

  it(
    'refuse a small spill in a far column whose padding is over the read cap',
    async () => {
      const doc = written(written(null, { kind: 'sheets', sheets: [{ name: 'Far' }] }), {
        kind: 'cells',
        sheet: 'Far',
        start: 'XFD1',
        rows: [['=SEQUENCE(100)']],
      })
      expect(read(doc)[0]!.rows[0]![16383]).toBe('=SEQUENCE(100)')

      expect(await values(doc)).toEqual({ refused: { reason: 'too_large' } })
    },
    TIMEOUT,
  )

  it(
    'refuse over 50,000 cells with a value',
    async () => {
      const doc = new Y.Doc()
      const id = addSheet(doc, 'Big')
      const rows = axis(doc, id, 'rows')
      const cols = Array.from({ length: 100 }, (_, c) => axis(doc, id, 'cols').ensure(c))
      doc.transact(() => {
        for (let row = 0; row < 500; row++) {
          const rowId = rows.ensure(row)
          for (const col of cols) roots(doc).inputs.set(cellKey(id, rowId, col), '1')
        }
      })
      const full = await values(doc)
      expect('sheets' in full && full.sheets[0]!.rows[499]![99]).toBe('1')

      roots(doc).inputs.set(cellKey(id, rows.ensure(500), cols[0]!), '1')
      expect(await values(doc)).toEqual({ refused: { reason: 'too_many_values' } })
    },
    TIMEOUT,
  )
})
