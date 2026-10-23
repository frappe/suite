import { describe, expect, it } from 'vitest'

import { roots } from './schema'
import { cmd, displays, inputs, storeState, sync, twoTabs, type, type Tab } from './test-tabs'
import { createUndo, type Selection, type Undo } from './undo'

// Collab undo on a tab, with a selection the test moves by hand (the editor's grid).
function withUndo(t: Tab) {
  let selection: Selection | null = null
  const undo = createUndo({ doc: t.doc, glue: t.glue, getSelection: () => selection })
  return {
    undo,
    select: (s: Selection | null) => (selection = s),
  }
}

async function undoTabs(): Promise<[Tab, Tab, Undo]> {
  const [a, b] = await twoTabs()
  return [a, b, withUndo(a).undo]
}

async function expectConverged(a: Tab, b: Tab) {
  await sync(a, b)
  expect(await inputs(b)).toEqual(await inputs(a))
  expect(await displays(b)).toEqual(await displays(a))
  expect(storeState(b)).toEqual(storeState(a))
}

async function insertRow(t: Tab, row: number) {
  t.glue.dispatch(cmd('insertRows', { sheet: 'Sheet1', row, count: 1 }))
  await t.glue.commit()
}

describe('undo: own steps', () => {
  it('undoes and redoes typing, one commit per step', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'A1', '1')
    await type(a, 'Sheet1', 'A2', '=A1*2')
    expect(await ua.undo()).toMatchObject({ done: true })
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': '1' })
    await ua.redo()
    expect((await displays(a))['Sheet1!A2']).toBe('2')
    await expectConverged(a, b)
  })

  it('undoes clearing a cell', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'B2', 'x')
    await type(a, 'Sheet1', 'B2', '')
    expect(await ua.undo()).toEqual({ done: true, selection: null })
    expect(await inputs(a)).toEqual({ 'Sheet1!B2': 'x' })
    await expectConverged(a, b)
  })

  it('undoes a row insert: cells move back and formulas point where they did', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'A1', '1')
    await type(a, 'Sheet1', 'A2', '=A1*2')
    await insertRow(a, 1)
    expect(await inputs(a)).toEqual({ 'Sheet1!A2': '1', 'Sheet1!A3': '=A2*2' })
    await ua.undo()
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': '1', 'Sheet1!A2': '=A1*2' })
    await ua.redo()
    expect(await inputs(a)).toEqual({ 'Sheet1!A2': '1', 'Sheet1!A3': '=A2*2' })
    await expectConverged(a, b)
  })

  it('undoes a row delete: its cells and the formulas that read them come back', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'A1', '1')
    await type(a, 'Sheet1', 'A2', '=A1*2')
    a.glue.dispatch(cmd('deleteRows', { sheet: 'Sheet1', row: 1, count: 1 }))
    await a.glue.commit()
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': '=#REF!*2' })
    await ua.undo()
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': '1', 'Sheet1!A2': '=A1*2' })
    expect((await displays(a))['Sheet1!A2']).toBe('2')
    await expectConverged(a, b)
  })

  it('undoes adding a sheet', async () => {
    const [a, b, ua] = await undoTabs()
    a.glue.dispatch(cmd('addSheet', { name: 'Two' }))
    await a.glue.commit()
    await type(a, 'Two', 'A1', 'x')
    await ua.undo()
    await ua.undo()
    expect(a.client.sheets).toEqual(['Sheet1'])
    await sync(a, b)
    expect(b.client.sheets).toEqual(['Sheet1'])
  })

  it("never undoes the other tab's steps", async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'A1', 'mine')
    await sync(a, b)
    await type(b, 'Sheet1', 'B1', 'theirs')
    await sync(a, b)
    await ua.undo()
    expect(ua.canUndo()).toBe(false)
    expect(await ua.undo()).toMatchObject({ done: false })
    await expectConverged(a, b)
    expect(await inputs(a)).toEqual({ 'Sheet1!B1': 'theirs' })
  })

  it("a new step clears redo; the other tab's steps don't", async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'A1', '1')
    await ua.undo()
    await type(b, 'Sheet1', 'B1', 'theirs')
    await sync(a, b)
    expect(ua.canRedo()).toBe(true)
    await type(a, 'Sheet1', 'A2', '2')
    expect(ua.canRedo()).toBe(false)
  })

  it("growing rows is not undone: the other tab's cell in a grown row survives", async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'C5', 'mine') // grows rows e1..e5 and cols e1..e3
    await sync(a, b)
    await type(b, 'Sheet1', 'D5', 'theirs')
    await sync(a, b)
    await ua.undo()
    await expectConverged(a, b)
    expect(await inputs(a)).toEqual({ 'Sheet1!D5': 'theirs' })
  })

  it('never lowers the high-water mark of grown row names', async () => {
    const [a, , ua] = await undoTabs()
    await type(a, 'Sheet1', 'A3', 'x')
    const tails = JSON.stringify([...roots(a.doc).tails.entries()])
    await ua.undo()
    expect(JSON.stringify([...roots(a.doc).tails.entries()])).toBe(tails)
  })

  it('an action not committed yet is committed first, then undone', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'A1', 'kept')
    a.glue.dispatch(cmd('setInput', { sheet: 'Sheet1', row: 2, col: 1, input: 'open' }))
    await ua.undo()
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': 'kept' })
    expect(ua.canUndo()).toBe(true)
    await expectConverged(a, b)
  })

  it('keeps at most maxSteps steps', async () => {
    const [a] = await twoTabs()
    const ua = createUndo({ doc: a.doc, glue: a.glue, maxSteps: 3 })
    for (let i = 1; i <= 5; i++) await type(a, 'Sheet1', `A${i}`, String(i))
    let n = 0
    while ((await ua.undo()).done) n++
    expect(n).toBe(3)
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': '1', 'Sheet1!A2': '2' })
  })
})

describe('undo: the old undo bugs (ISSUES #11 #13 #15 #16)', () => {
  it('#11: add then edit a CF rule: two undos, no dead step', async () => {
    const [a, , ua] = await undoTabs()
    const range = { r0: 0, c0: 0, r1: 2, c1: 0 }
    await a.glue.commit() // the dialog's "before" bracket: nothing changed
    const id = a.stores.condFormat.addRule(
      { range, condition: { type: 'gt', value: '1' } },
      'Sheet1',
    )
    await a.glue.commit()
    await a.glue.commit()
    a.stores.condFormat.updateRule(id, { condition: { type: 'gt', value: '5' } }, 'Sheet1')
    await a.glue.commit()
    await a.glue.commit()
    await ua.undo()
    expect(a.stores.condFormat.getRules('Sheet1')).toMatchObject([{ condition: { value: '1' } }])
    await ua.undo()
    expect(a.stores.condFormat.getRules('Sheet1')).toEqual([])
    expect(ua.canUndo()).toBe(false)
  })

  it('#13: a store-only action (protect a range) enables Undo and tells the editor', async () => {
    const [a, , ua] = await undoTabs()
    let changes = 0
    ua.onChange(() => changes++)
    expect(ua.canUndo()).toBe(false)
    a.stores.protection.addRange({ r0: 0, c0: 0, r1: 1, c1: 1 }, '', 'Sheet1')
    await a.glue.commit()
    expect(ua.canUndo()).toBe(true)
    expect(changes).toBeGreaterThan(0)
    await ua.undo()
    expect(a.stores.protection.getRanges('Sheet1')).toEqual([])
    expect(ua.canUndo()).toBe(false)
    expect(ua.canRedo()).toBe(true)
  })

  it('#15: the same font size applied twice (Enter, then blur) is one step', async () => {
    const [a, , ua] = await undoTabs()
    a.stores.formats.applyToRange(['A1'], { fontSize: 18 }, 'Sheet1')
    await a.glue.commit()
    a.stores.formats.applyToRange(['A1'], { fontSize: 18 }, 'Sheet1')
    await a.glue.commit()
    await ua.undo()
    expect(a.stores.formats.snapshot().Sheet1?.cells?.A1).toBeUndefined()
    expect(ua.canUndo()).toBe(false)
  })

  it('#16: undo and redo hand back the selection the step was made with', async () => {
    const [a, b] = await twoTabs()
    const { undo: ua, select } = withUndo(a)
    const b3 = { sheet: 'Sheet1', r0: 2, c0: 1, r1: 2, c1: 1 }
    select(b3)
    await type(a, 'Sheet1', 'B3', 'x')
    select({ sheet: 'Sheet1', r0: 9, c0: 3, r1: 9, c1: 3 }) // moved away to D10
    expect((await ua.undo()).selection).toEqual(b3)
    expect((await ua.redo()).selection).toEqual(b3)
    // The other tab inserts a row above: the selection follows its cell.
    await sync(a, b)
    await insertRow(b, 1)
    await sync(a, b)
    expect((await ua.undo()).selection).toEqual({ ...b3, r0: 3, r1: 3 })
  })
})

describe('undo: refusals (COLLAB-DESIGN Q17)', () => {
  it('refuses undoing my row insert after the other tab typed in it, and drops the step', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'A1', 'top')
    await type(a, 'Sheet1', 'A2', 'below')
    await insertRow(a, 2)
    await sync(a, b)
    await type(b, 'Sheet1', 'C2', 'theirs')
    await sync(a, b)
    expect(await ua.undo()).toMatchObject({ done: false, refused: 'edited' })
    const after = { 'Sheet1!A1': 'top', 'Sheet1!C2': 'theirs', 'Sheet1!A3': 'below' }
    expect(await inputs(a)).toEqual(after)
    // The step is gone: the next undo is the one before it.
    await ua.undo()
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': 'top', 'Sheet1!C2': 'theirs' })
    await expectConverged(a, b)
  })

  it('refuses when the other tab only formatted a cell in my new column', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'C1', 'x')
    a.glue.dispatch(cmd('insertColumns', { sheet: 'Sheet1', col: 2, count: 1 }))
    await a.glue.commit()
    await sync(a, b)
    b.stores.formats.applyToRange(['B4'], { bold: true }, 'Sheet1')
    await b.glue.commit()
    await sync(a, b)
    expect(await ua.undo()).toMatchObject({ done: false, refused: 'edited' })
    expect(await inputs(a)).toEqual({ 'Sheet1!D1': 'x' })
  })

  it('refuses undoing my new sheet after the other tab typed in it', async () => {
    const [a, b, ua] = await undoTabs()
    a.glue.dispatch(cmd('addSheet', { name: 'Two' }))
    await a.glue.commit()
    await sync(a, b)
    await type(b, 'Two', 'A1', 'theirs')
    await sync(a, b)
    expect(await ua.undo()).toMatchObject({ done: false, refused: 'edited' })
    expect(a.client.sheets).toEqual(['Sheet1', 'Two'])
  })

  it('undoes my row insert when the other tab typed elsewhere', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'A1', 'x')
    await insertRow(a, 1)
    await sync(a, b)
    await type(b, 'Sheet1', 'C5', 'theirs')
    await sync(a, b)
    expect(await ua.undo()).toMatchObject({ done: true })
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': 'x', 'Sheet1!C4': 'theirs' })
    await expectConverged(a, b)
  })

  it('refuses undoing my value after the other tab overwrote it, keeps theirs, drops the step', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'C1', '=B4*2')
    await type(a, 'Sheet1', 'B4', '500')
    await sync(a, b)
    await type(b, 'Sheet1', 'B4', '700')
    await sync(a, b)
    expect(await ua.undo()).toMatchObject({ done: false, refused: 'edited' })
    expect(await inputs(a)).toEqual({ 'Sheet1!C1': '=B4*2', 'Sheet1!B4': '700' })
    // One Ctrl+Z did one thing: C1 is still there until the next undo.
    await ua.undo()
    expect(await inputs(a)).toEqual({ 'Sheet1!B4': '700' })
    await expectConverged(a, b)
  })

  it('my inserted row was deleted by the other tab: undo does nothing and stops there', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'A1', 'x')
    await insertRow(a, 1)
    await sync(a, b)
    b.glue.dispatch(cmd('deleteRows', { sheet: 'Sheet1', row: 1, count: 1 }))
    await b.glue.commit()
    await sync(a, b)
    expect(await ua.undo()).toMatchObject({ done: false, refused: 'edited' })
    // One Ctrl+Z did not also undo the typing before it.
    expect(await inputs(a)).toEqual({ 'Sheet1!A1': 'x' })
    expect(ua.canUndo()).toBe(true)
  })

  it('refuses undoing my value after the other tab cleared it', async () => {
    const [a, b, ua] = await undoTabs()
    await type(a, 'Sheet1', 'B4', 'old')
    await type(a, 'Sheet1', 'B4', 'mine')
    await sync(a, b)
    await type(b, 'Sheet1', 'B4', '')
    await sync(a, b)
    expect(await ua.undo()).toMatchObject({ done: false, refused: 'edited' })
    expect(await inputs(a)).toEqual({})
    await expectConverged(a, b)
  })

  it('a paste the other tab partly overwrote: undoes the rest, keeps theirs, says so', async () => {
    const [a, b, ua] = await undoTabs()
    a.glue.dispatch(
      cmd('batch', {
        commands: [1, 2, 3].map((row) =>
          cmd('setInput', { sheet: 'Sheet1', row, col: 1, input: `p${row}` }),
        ),
      }),
    )
    await a.glue.commit()
    await sync(a, b)
    await type(b, 'Sheet1', 'A2', 'theirs')
    await sync(a, b)
    expect(await ua.undo()).toMatchObject({ done: true, refused: 'partial' })
    expect(await inputs(a)).toEqual({ 'Sheet1!A2': 'theirs' })
    await expectConverged(a, b)
  })
})
