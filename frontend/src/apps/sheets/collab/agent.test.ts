import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

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
    'refuse over 50,000 typed cells',
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
      expect(await values(doc)).toEqual({ refused: { reason: 'too_many_inputs' } })
    },
    TIMEOUT,
  )
})
