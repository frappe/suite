import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createGlue } from './glue'
import { roots } from './schema'
import { docSheets, storeEntries } from './stores'
import {
  cmd,
  displays,
  inputs,
  makeStores,
  newClient,
  openTab,
  storeState,
  sync,
  twoTabs,
  type,
  type Tab,
} from './test-tabs'

// Each test drives real IronCalc workbooks through several round trips: ~2 s
// locally, more on CI runners (vitest's 5 s default timed out there).
const GLUE_TIMEOUT = 30_000

// Both tabs hold the same cells and the same side stores.
async function expectConverged(a: Tab, b: Tab) {
  expect(await inputs(b)).toEqual(await inputs(a))
  expect(await displays(b)).toEqual(await displays(a))
  expect(storeState(b)).toEqual(storeState(a))
  expect(a.client.sheets).toEqual(b.client.sheets)
}

describe('glue: cells', { timeout: GLUE_TIMEOUT }, () => {
  it("a tab's typing reaches the other tab, which recalculates", async () => {
    const [a, b] = await twoTabs()
    await type(a, 'Sheet1', 'B4', '500')
    await type(a, 'Sheet1', 'C1', '=B4*2')
    await sync(a, b)
    expect(await inputs(b)).toEqual({ 'Sheet1!B4': '500', 'Sheet1!C1': '=B4*2' })
    expect((await displays(b))['Sheet1!C1']).toBe('1000')
  })

  it('writes typed inputs to the doc by row and column id, never results', async () => {
    const [a] = await twoTabs()
    await type(a, 'Sheet1', 'A2', '=1+1')
    const values = [...roots(a.doc).inputs.values()]
    expect(values).toEqual(['=1+1'])
  })

  it('one user action is one doc update', async () => {
    const [a] = await twoTabs()
    a.glue.dispatch(
      cmd('batch', {
        commands: [
          cmd('setInput', { sheet: 'Sheet1', row: 1, col: 1, input: '1' }),
          cmd('setInput', { sheet: 'Sheet1', row: 2, col: 1, input: '2' }),
        ],
      }),
    )
    a.stores.formats.applyToRange(['A1'], { bold: true }, 'Sheet1')
    await a.glue.commit()
    expect(a.outbox).toHaveLength(1)
  })

  it('clearing cells deletes their inputs', async () => {
    const [a, b] = await twoTabs()
    await type(a, 'Sheet1', 'A1', 'x')
    await type(a, 'Sheet1', 'B2', 'y')
    a.glue.dispatch(
      cmd('clearContents', { sheet: 'Sheet1', range: { r1: 1, c1: 1, r2: 1, c2: 1 } }),
    )
    await a.glue.commit()
    await sync(a, b)
    expect(await inputs(b)).toEqual({ 'Sheet1!B2': 'y' })
    expect(roots(a.doc).inputs.size).toBe(1)
  })

  it('a change that came from the other tab is not sent back (no echo)', async () => {
    const [a, b] = await twoTabs()
    await type(a, 'Sheet1', 'A1', 'hello')
    await sync(a, b)
    await b.glue.commit()
    expect(b.outbox).toHaveLength(0)
    expect(a.outbox).toHaveLength(0)
  })

  it('concurrent edits on different cells both survive', async () => {
    const [a, b] = await twoTabs()
    await type(a, 'Sheet1', 'A1', 'from A')
    await type(b, 'Sheet1', 'C3', 'from B')
    await sync(a, b)
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': 'from A', 'Sheet1!C3': 'from B' })
    await expectConverged(a, b)
  })

  it('pivot output written through localOnly stays out of the doc', async () => {
    const [a, b] = await twoTabs()
    a.glue.localOnly(() =>
      a.glue.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 1, col: 5, input: 'Sum of x' })),
    )
    await a.glue.commit()
    await sync(a, b)
    expect(roots(a.doc).inputs.size).toBe(0)
    expect(await inputs(a)).toEqual({ 'Sheet1!E1': 'Sum of x' })
    expect(await inputs(b)).toEqual({})
  })

  it('holds a remote update while a local action is not committed yet', async () => {
    const [a, b] = await twoTabs()
    await type(a, 'Sheet1', 'A1', 'top')
    await sync(a, b)
    a.glue.dispatch(cmd('insertRows', { sheet: 'Sheet1', row: 1, count: 1 }))
    await a.glue.commit()
    // B types into A2 by position while A's insert is on its way: B's own
    // command is not committed when the insert arrives, so the insert waits.
    b.glue.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 1, col: 2, input: 'next to top' }))
    for (const m of a.outbox.splice(0)) b.glue.receive(m)
    await b.glue.commit()
    await sync(a, b)
    // B typed next to "top" (row 1 on B's screen) before it saw the insert.
    expect(await inputs(a)).toEqual({ 'Sheet1!A2': 'top', 'Sheet1!B2': 'next to top' })
    await expectConverged(a, b)
  })
})

describe('glue: rows, columns and sheets', { timeout: GLUE_TIMEOUT }, () => {
  async function numbers(a: Tab) {
    for (let r = 1; r <= 5; r++) await type(a, 'Sheet1', `A${r}`, String(r))
    await type(a, 'Sheet1', 'C1', '=SUM(A1:A5)')
  }

  it('an insert racing an edit keeps the edit on its row', async () => {
    const [a, b] = await twoTabs()
    await numbers(a)
    await sync(a, b)
    a.glue.dispatch(cmd('insertRows', { sheet: 'Sheet1', row: 2, count: 1 }))
    await a.glue.commit()
    await type(b, 'Sheet1', 'B5', 'five')
    await sync(a, b)
    const got = await inputs(a)
    expect(got['Sheet1!A6']).toBe('5')
    expect(got['Sheet1!B6']).toBe('five')
    expect(got['Sheet1!C1']).toBe('=SUM(A1:A6)')
    await expectConverged(a, b)
  })

  it('delete wins over an edit in the deleted row', async () => {
    const [a, b] = await twoTabs()
    await numbers(a)
    await sync(a, b)
    a.glue.dispatch(cmd('deleteRows', { sheet: 'Sheet1', row: 3, count: 1 }))
    await a.glue.commit()
    await type(b, 'Sheet1', 'B3', 'lost')
    await sync(a, b)
    const got = await inputs(b)
    expect(Object.values(got)).not.toContain('lost')
    expect(got['Sheet1!A3']).toBe('4')
    await expectConverged(a, b)
  })

  it('column insert and delete, and a column move', async () => {
    const [a, b] = await twoTabs()
    await type(a, 'Sheet1', 'A1', 'a')
    await type(a, 'Sheet1', 'B1', 'b')
    await type(a, 'Sheet1', 'C1', 'c')
    await type(a, 'Sheet1', 'D1', '=A1&B1&C1')
    await sync(a, b)
    a.glue.dispatch(cmd('insertColumns', { sheet: 'Sheet1', col: 2, count: 2 }))
    await a.glue.commit()
    b.glue.dispatch(cmd('moveColumns', { sheet: 'Sheet1', col: 3, count: 1, delta: -2 }))
    await b.glue.commit()
    await sync(a, b)
    await expectConverged(a, b)
    a.glue.dispatch(cmd('deleteColumns', { sheet: 'Sheet1', col: 1, count: 1 }))
    await a.glue.commit()
    await sync(a, b)
    await expectConverged(a, b)
  })

  it('moving rows keeps each row with its cells', async () => {
    const [a, b] = await twoTabs()
    await numbers(a)
    await sync(a, b)
    a.glue.dispatch(cmd('moveRows', { sheet: 'Sheet1', row: 1, count: 2, delta: 3 }))
    await a.glue.commit()
    await type(b, 'Sheet1', 'B1', 'with one')
    await sync(a, b)
    const got = await inputs(a)
    expect(got['Sheet1!A4']).toBe('1')
    expect(got['Sheet1!B4']).toBe('with one')
    await expectConverged(a, b)
  })

  it('a moved row whose update arrives before one it depends on keeps its cells', async () => {
    const [a, b] = await twoTabs()
    const c = await openTab('C', a.doc)
    await type(a, 'Sheet1', 'A2', 'x')
    await sync(a, b, c)
    await type(c, 'Sheet1', 'A5', 'from C') // C grows the row list to 5
    for (const m of c.outbox.splice(0)) b.glue.receive(m)
    await b.glue.settled()
    // B moves row 2 below C's new rows: its update depends on C's.
    b.glue.dispatch(cmd('moveRows', { sheet: 'Sheet1', row: 2, count: 1, delta: 4 }))
    await b.glue.commit()
    // A gets B's update first: the row's delete applies, its re-insert waits for C's.
    for (const m of b.outbox.splice(0)) a.glue.receive(m)
    await a.glue.settled()
    a.glue.receive(Y.encodeStateAsUpdate(c.doc))
    await a.glue.settled()
    expect(await inputs(a)).toEqual({ 'Sheet1!A4': 'from C', 'Sheet1!A6': 'x' })
    await expectConverged(a, b)
  })

  it('a sheet rename reaches the other tab and rewrites formulas there', async () => {
    const [a, b] = await twoTabs()
    a.glue.dispatch(cmd('addSheet', { name: 'Sheet2' }))
    await a.glue.commit()
    await type(a, 'Sheet1', 'A1', '=Sheet2!A1*2')
    await sync(a, b)
    a.glue.dispatch(cmd('renameSheet', { sheet: 'Sheet2', name: 'Data' }))
    await a.glue.commit()
    await type(b, 'Sheet2', 'A1', '21')
    await sync(a, b)
    expect(b.client.sheets).toEqual(['Sheet1', 'Data'])
    expect(await inputs(b)).toEqual({ 'Sheet1!A1': '=Data!A1*2', 'Data!A1': '21' })
    expect((await displays(b))['Sheet1!A1']).toBe('42')
    await expectConverged(a, b)
  })

  it('sheet add, move, duplicate and delete', async () => {
    const [a, b] = await twoTabs()
    await type(a, 'Sheet1', 'A1', 'one')
    a.glue.dispatch(cmd('addSheet', { name: 'Two' }))
    a.glue.dispatch(cmd('duplicateSheet', { sheet: 'Sheet1', name: 'Copy' }))
    a.glue.dispatch(cmd('moveSheet', { sheet: 'Copy', index: 0 }))
    await a.glue.commit()
    await sync(a, b)
    expect(b.client.sheets).toEqual(['Copy', 'Sheet1', 'Two'])
    expect(await inputs(b)).toEqual({ 'Copy!A1': 'one', 'Sheet1!A1': 'one' })
    b.glue.dispatch(cmd('deleteSheet', { sheet: 'Sheet1' }))
    await b.glue.commit()
    await sync(a, b)
    expect(a.client.sheets).toEqual(['Copy', 'Two'])
    await expectConverged(a, b)
  })

  it('two tabs adding a sheet with the same name both keep theirs', async () => {
    const [a, b] = await twoTabs()
    a.glue.dispatch(cmd('addSheet', { name: 'Sheet2' }))
    await a.glue.commit()
    await type(a, 'Sheet2', 'A1', 'from A')
    b.glue.dispatch(cmd('addSheet', { name: 'Sheet2' }))
    await b.glue.commit()
    await type(b, 'Sheet2', 'A1', 'from B')
    await sync(a, b)
    expect(a.client.sheets).toHaveLength(3)
    expect(Object.values(await inputs(a)).sort()).toEqual(['from A', 'from B'])
    await expectConverged(a, b)
  })
})

describe('glue: side stores', { timeout: GLUE_TIMEOUT }, () => {
  it('a format, a comment and a merge reach the other tab', async () => {
    const [a, b] = await twoTabs()
    a.stores.formats.applyToRange(['B4'], { bold: true }, 'Sheet1')
    a.stores.comments.addReply('B4', { text: 'check', ts: 1 }, 'Sheet1')
    a.stores.merge.merge(0, 0, 1, 1, 'Sheet1')
    await a.glue.commit()
    await sync(a, b)
    expect(b.stores.formats.snapshot().Sheet1?.cells.B4).toEqual({ bold: true })
    expect(b.stores.comments.getThread('B4', 'Sheet1')?.thread[0]?.text).toBe('check')
    expect(b.stores.merge.isMaster('A1', 'Sheet1')).toBe(true)
    await expectConverged(a, b)
  })

  it('removing a comment or a chart removes it in the other tab', async () => {
    const [a, b] = await twoTabs()
    a.stores.comments.addReply('A1', { text: 'x', ts: 1 }, 'Sheet1')
    const chart = a.stores.charts.add({ sourceSheet: 'Sheet1', sourceRange: 'A1:B2' })
    await a.glue.commit()
    await sync(a, b)
    a.stores.comments.clear('A1', 'Sheet1')
    a.stores.charts.remove(chart)
    await a.glue.commit()
    await sync(a, b)
    expect(b.stores.comments.getThread('A1', 'Sheet1')).toBeNull()
    expect(b.stores.charts.list()).toEqual([])
    await expectConverged(a, b)
  })

  it('a bold and a typed value on the same cell at once both survive', async () => {
    const [a, b] = await twoTabs()
    a.stores.formats.applyToRange(['B4'], { bold: true }, 'Sheet1')
    await a.glue.commit()
    await type(b, 'Sheet1', 'B4', '700')
    await sync(a, b)
    expect(b.stores.formats.snapshot().Sheet1?.cells.B4).toEqual({ bold: true })
    expect((await inputs(a))['Sheet1!B4']).toBe('700')
    await expectConverged(a, b)
  })

  it('a chart and a CF rule added at once in two tabs are both kept', async () => {
    const [a, b] = await twoTabs()
    const range = { r0: 0, c0: 0, r1: 9, c1: 0 }
    a.stores.charts.add({
      sourceSheet: 'Sheet1',
      sourceRange: 'A1:B5',
      position: { sheet: 'Sheet1', x: 0, y: 0, width: 480, height: 320 },
    })
    a.stores.condFormat.addRule({ range, condition: { type: 'gt', value: '1' } }, 'Sheet1')
    await a.glue.commit()
    b.stores.charts.add({
      sourceSheet: 'Sheet1',
      sourceRange: 'C1:D5',
      position: { sheet: 'Sheet1', x: 0, y: 0, width: 480, height: 320 },
    })
    b.stores.condFormat.addRule({ range, condition: { type: 'lt', value: '0' } }, 'Sheet1')
    await b.glue.commit()
    await sync(a, b)
    expect(a.stores.charts.list()).toHaveLength(2)
    expect(b.stores.condFormat.getRules('Sheet1')).toHaveLength(2)
    await expectConverged(a, b)
  })

  it('a format follows its row when the other tab inserts above it', async () => {
    const [a, b] = await twoTabs()
    a.stores.formats.applyToRange(['A3'], { fill: '#ff0' }, 'Sheet1')
    await a.glue.commit()
    await sync(a, b)
    b.glue.dispatch(cmd('insertRows', { sheet: 'Sheet1', row: 1, count: 2 }))
    // The editor remaps its stores on an insert (engine/ref-remap.ts); here by hand.
    b.stores.formats.restore({ Sheet1: { cells: { A5: { fill: '#ff0' } }, rows: {}, cols: {} } })
    await b.glue.commit()
    await sync(a, b)
    expect(Object.keys(a.stores.formats.snapshot().Sheet1?.cells ?? {})).toEqual(['A5'])
    await expectConverged(a, b)
  })

  it('a remote change tells the editor what to repaint', async () => {
    const [a, b] = await twoTabs()
    const seen: unknown[] = []
    b.glue.onRemote((change) => seen.push(change))
    a.stores.comments.addReply('A1', { text: 'x', ts: 1 }, 'Sheet1')
    await a.glue.commit()
    await type(a, 'Sheet1', 'A1', '1')
    await sync(a, b)
    expect(seen).toEqual([
      { cells: false, sheets: false, stores: ['comments'] },
      { cells: true, sheets: false, stores: [] },
    ])
  })
})

describe('glue: load', { timeout: GLUE_TIMEOUT }, () => {
  it('a new tab builds its workbook and stores from the doc', async () => {
    const [a] = await twoTabs()
    a.glue.dispatch(cmd('addSheet', { name: 'Data' }))
    await a.glue.commit()
    await type(a, 'Data', 'B2', '7')
    await type(a, 'Sheet1', 'A1', '=Data!B2+1')
    a.stores.formats.applyToRange(['A1'], { italic: true }, 'Sheet1')
    await a.glue.commit()
    const c = await openTab('C', a.doc)
    expect(c.client.sheets).toEqual(['Sheet1', 'Data'])
    expect((await displays(c))['Sheet1!A1']).toBe('8')
    await expectConverged(a, c)
  })

  it('an update that arrives while a tab is still loading reaches its IronCalc', async () => {
    const [a] = await twoTabs()
    await type(a, 'Sheet1', 'A1', 'before')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(a.doc))
    const c = { client: await newClient(), stores: makeStores() }
    const glue = createGlue({ doc, ...c })
    await type(a, 'Sheet1', 'A2', 'during')
    const loading = glue.load() // builds IronCalc from the doc as it is now…
    for (const m of a.outbox.splice(0)) glue.receive(m) // …while A's next edit arrives
    await loading
    await glue.settled()
    expect(await inputs({ ...c, doc, glue, name: 'C', outbox: [] })).toEqual({
      'Sheet1!A1': 'before',
      'Sheet1!A2': 'during',
    })
  })

  it('a doc with a sheet named Sheet1 elsewhere loads', async () => {
    const [a] = await twoTabs()
    a.glue.dispatch(cmd('renameSheet', { sheet: 'Sheet1', name: 'First' }))
    a.glue.dispatch(cmd('addSheet', { name: 'Sheet1' }))
    await a.glue.commit()
    await type(a, 'Sheet1', 'A1', 'second')
    const c = await openTab('C', a.doc)
    expect(c.client.sheets).toEqual(['First', 'Sheet1'])
    await expectConverged(a, c)
  })

  it('an existing workbook and its stores fill an empty doc, minus pivot output', async () => {
    const client = await newClient()
    const stores = makeStores()
    client.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 1, col: 1, input: '10' }))
    client.dispatch(cmd('addSheet', { name: 'Data' }))
    client.dispatch(cmd('setInput', { sheet: 'Data', row: 2, col: 2, input: '=Sheet1!A1*3' }))
    client.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 1, col: 5, input: 'Sum of x' }))
    stores.formats.applyToRange(['A1'], { bold: true }, 'Sheet1')
    const pivot = stores.pivot.add({
      sourceSheet: 'Sheet1',
      sourceRange: 'A1:A1',
      outputSheet: 'Sheet1',
      anchorCol: 4,
    })
    stores.pivot.setExtent(pivot, { r0: 0, c0: 4, r1: 0, c1: 4 })
    const doc = new Y.Doc()
    await createGlue({ doc, client, stores }).load()

    expect(roots(doc).meta.get('schemaVersion')).toBe(1)
    expect(docSheets(doc).map((s) => s.name)).toEqual(['Sheet1', 'Data'])
    expect([...roots(doc).inputs.values()].sort()).toEqual(['10', '=Sheet1!A1*3'])
    const c = await openTab('C', doc)
    expect(await inputs(c)).toEqual({ 'Sheet1!A1': '10', 'Data!B2': '=Sheet1!A1*3' })
    expect((await displays(c))['Data!B2']).toBe('30')
    expect(storeState(c)).toEqual(
      storeEntries(stores)
        .map((e) => JSON.stringify(e))
        .sort(),
    )
  })
})
