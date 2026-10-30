import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { describe, expect, it } from 'vitest'

import { CommandTypes } from '../core/commands.js'
import { createWorkbook } from '../core/workbook.js'
import { createNamedRanges, definedNameChanges, definedNameFormula } from './named-ranges.js'
import { deleteMap, insertMap } from './ref-remap.js'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

let seq = 0
const cmd = (type, payload) => ({ id: `n${seq++}`, actor: 'test', ts: seq, type, payload })

describe('definedNameFormula', () => {
  it('quotes the sheet and makes the range absolute', () => {
    expect(definedNameFormula({ sheet: 'Sheet1', range: 'b2:B9' })).toBe("'Sheet1'!$B$2:$B$9")
    expect(definedNameFormula({ sheet: "Bob's data", range: 'A1' })).toBe("'Bob''s data'!$A$1")
  })

  it('gives IronCalc a name it evaluates, on a sheet with a space and a quote', () => {
    const wb = createWorkbook()
    wb.apply(cmd(CommandTypes.addSheet, { name: "Bob's data" }))
    for (const [row, v] of [
      [1, '4'],
      [2, '6'],
    ])
      wb.apply(cmd(CommandTypes.setInput, { sheet: "Bob's data", row, col: 1, input: v }))
    wb.apply(
      cmd(CommandTypes.setDefinedName, {
        name: 'Revenue',
        formula: definedNameFormula({ sheet: "Bob's data", range: 'A1:A2' }),
      }),
    )
    wb.apply(
      cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 1, col: 1, input: '=SUM(Revenue)' }),
    )
    expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('10')
  })
})

// ISSUES #74: IronCalc never moves a defined name on a row/column edit; the
// store remaps its entries and the editor sends IronCalc what changed
// (useWorkbook syncDefinedNames). A name whose cells are all deleted has no
// formula IronCalc takes, so it is dropped from IronCalc: `=Name` is an error.
describe('names follow row and column edits', () => {
  // A1:A10 = 10..100 on Sheet1; C12..E12 read the names.
  const start = (names) => {
    const wb = createWorkbook()
    for (let r = 1; r <= 10; r++)
      wb.apply(
        cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: r, col: 1, input: String(r * 10) }),
      )
    const nr = createNamedRanges()
    for (const [name, range, sheet = 'Sheet1'] of names) nr.add({ name, sheet, range })
    const t = { wb, nr, sent: new Map() }
    sync(t)
    return t
  }
  // As useWorkbook does: one command alone, several in one batch.
  const sync = (t) => {
    const { sent, changes } = definedNameChanges(t.sent, t.nr.list(), t.wb.getSheets())
    t.sent = sent
    const commands = changes.map((c) => cmd(c.type, c.payload))
    if (commands.length === 1) t.wb.apply(commands[0])
    else if (commands.length > 1) t.wb.apply(cmd(CommandTypes.batch, { commands }))
  }
  // A row/column edit as the editor makes it (useHistory applyStructural).
  const edit = (t, type, at, count = 1, sheet = 'Sheet1') => {
    const rows = type.endsWith('Rows')
    t.wb.apply(cmd(CommandTypes[type], { sheet, count, ...(rows ? { row: at } : { col: at }) }))
    const map = (type.startsWith('delete') ? deleteMap : insertMap)(at - 1, count)
    if (rows) t.nr.remapRows(map, sheet)
    else t.nr.remapCols(map, sheet)
    sync(t)
  }
  const put = (t, row, col, input) =>
    t.wb.apply(cmd(CommandTypes.setInput, { sheet: 'Sheet1', row, col, input }))
  const shown = (t, row, col) => t.wb.getDisplayValue('Sheet1', row, col)
  const range = (t, name) => t.nr.get(name).range

  it('deleting row 1: a range shrinks, a cell moves, a deleted cell is an error', () => {
    const t = start([
      ['rng', 'A1:A10'],
      ['five', 'A5'],
      ['one', 'A1'],
    ])
    put(t, 12, 3, '=SUM(rng)')
    put(t, 12, 4, '=five')
    put(t, 12, 5, '=one')
    edit(t, 'deleteRows', 1)
    expect(range(t, 'rng')).toBe('A1:A9')
    expect(shown(t, 11, 3)).toBe('540')
    // Moved in the same sync as the deleted name, which IronCalc would refuse.
    expect(shown(t, 11, 4)).toBe('50')
    expect(range(t, 'one')).toBe('#REF!')
    expect(shown(t, 11, 5)).toMatch(/^#/)
  })

  it('deleting rows inside a range, or all of them', () => {
    const t = start([
      ['rng', 'A1:A10'],
      ['pair', 'A9:A10'],
    ])
    put(t, 12, 3, '=SUM(rng)')
    put(t, 12, 4, '=SUM(pair)')
    edit(t, 'deleteRows', 3, 2)
    expect(range(t, 'rng')).toBe('A1:A8')
    expect(shown(t, 10, 3)).toBe('480')
    expect(range(t, 'pair')).toBe('A7:A8')
    edit(t, 'deleteRows', 7, 2)
    expect(range(t, 'pair')).toBe('#REF!')
    expect(shown(t, 8, 4)).toMatch(/^#/)
    expect(shown(t, 8, 3)).toBe('290')
  })

  it('inserting rows above a range moves it; inside one grows it', () => {
    const t = start([
      ['rng', 'A1:A10'],
      ['one', 'A1'],
    ])
    put(t, 12, 3, '=SUM(rng)')
    put(t, 12, 4, '=one')
    edit(t, 'insertRows', 1, 2)
    expect(range(t, 'rng')).toBe('A3:A12')
    expect(range(t, 'one')).toBe('A3')
    edit(t, 'insertRows', 5)
    expect(range(t, 'rng')).toBe('A3:A13')
    put(t, 5, 1, '1')
    expect(shown(t, 15, 3)).toBe('551')
    expect(shown(t, 15, 4)).toBe('10')
  })

  it('columns: delete and insert move and shrink names the same way', () => {
    const t = start([
      ['trio', 'B1:D1'],
      ['dee', 'D1'],
      ['bee', 'B1'],
    ])
    for (const [c, v] of [
      [2, '1'],
      [3, '2'],
      [4, '4'],
    ])
      put(t, 1, c, v)
    put(t, 5, 8, '=SUM(trio)')
    put(t, 5, 9, '=dee')
    put(t, 5, 10, '=bee')
    edit(t, 'deleteColumns', 2)
    expect(range(t, 'trio')).toBe('B1:C1')
    expect(shown(t, 5, 7)).toBe('6')
    expect(range(t, 'dee')).toBe('C1')
    expect(shown(t, 5, 8)).toBe('4')
    expect(range(t, 'bee')).toBe('#REF!')
    expect(shown(t, 5, 9)).toMatch(/^#/)
    edit(t, 'insertColumns', 1, 2)
    expect(range(t, 'trio')).toBe('D1:E1')
    expect(range(t, 'dee')).toBe('E1')
    expect(shown(t, 5, 9)).toBe('6')
  })

  it('an edit on another sheet leaves the names alone', () => {
    const t = start([['rng', 'A1:A10']])
    t.wb.apply(cmd(CommandTypes.addSheet, { name: 'Other' }))
    put(t, 12, 3, '=SUM(rng)')
    edit(t, 'deleteRows', 1, 3, 'Other')
    edit(t, 'insertColumns', 1, 1, 'Other')
    expect(range(t, 'rng')).toBe('A1:A10')
    expect(shown(t, 12, 3)).toBe('550')
  })

  // A delete's undo restores IronCalc's bytes from before it and the store's
  // snapshot (useHistory revertStructural), then syncs.
  it('undo brings back every name, the deleted one included', () => {
    const t = start([
      ['rng', 'A1:A10'],
      ['one', 'A1'],
    ])
    put(t, 12, 3, '=SUM(rng)')
    put(t, 12, 4, '=one')
    const bytes = t.wb.toBytes()
    const names = t.nr.snapshot()
    edit(t, 'deleteRows', 1)
    t.wb = createWorkbook({ loadBytes: bytes })
    t.nr.restore(names)
    sync(t)
    expect(range(t, 'rng')).toBe('A1:A10')
    expect(shown(t, 12, 3)).toBe('550')
    expect(shown(t, 12, 4)).toBe('10')
  })

  // Saved before this fix: IronCalc's bytes still hold the name at its old
  // cells. The first sync after a load, with nothing sent yet, drops it.
  it('drops a deleted name that saved bytes still hold, and one they never held', () => {
    const t = start([['one', 'A1']])
    put(t, 12, 4, '=one')
    t.nr.update('one', { range: 'A2' })
    t.nr.remapRows(deleteMap(1, 1), 'Sheet1')
    t.wb = createWorkbook({ loadBytes: t.wb.toBytes() })
    t.sent = new Map()
    t.nr.add({ name: 'gone', sheet: 'Sheet1', range: 'A3' })
    t.nr.remapRows(deleteMap(2, 1), 'Sheet1')
    sync(t)
    expect(shown(t, 12, 4)).toMatch(/^#/)
    expect(definedNameChanges(t.sent, t.nr.list(), t.wb.getSheets()).changes).toEqual([])
  })

  // ISSUES #77: IronCalc refuses a name on a sheet it doesn't have, which
  // failed the batch with every other name in it.
  describe('a name on a deleted sheet', () => {
    // rng on Sheet1 A1:A10; far on Data!A1 = 7. C12 = SUM(rng), D12 = far.
    const withData = () => {
      const t = start([['rng', 'A1:A10']])
      t.wb.apply(cmd(CommandTypes.addSheet, { name: 'Data' }))
      t.wb.apply(cmd(CommandTypes.setInput, { sheet: 'Data', row: 1, col: 1, input: '7' }))
      t.nr.add({ name: 'far', sheet: 'Data', range: 'A1' })
      sync(t)
      put(t, 12, 3, '=SUM(rng)')
      put(t, 12, 4, '=far')
      return t
    }
    // As the editor deletes a tab (index.vue doDeleteSheet).
    const deleteData = (t) => {
      t.wb.apply(cmd(CommandTypes.deleteSheet, { sheet: 'Data' }))
      t.nr.deleteSheet('Data')
      sync(t)
    }

    it('is #REF! after the delete; the other names still move and evaluate', () => {
      const t = withData()
      expect(shown(t, 12, 4)).toBe('7')
      deleteData(t)
      expect(range(t, 'far')).toBe('#REF!')
      expect(shown(t, 12, 4)).toMatch(/^#/)
      edit(t, 'deleteRows', 1)
      expect(range(t, 'rng')).toBe('A1:A9')
      expect(shown(t, 11, 3)).toBe('540')
      // As in Excel, a new sheet with the old name doesn't bring it back.
      t.wb.apply(cmd(CommandTypes.addSheet, { name: 'Data' }))
      sync(t)
      expect(range(t, 'far')).toBe('#REF!')
      expect(shown(t, 11, 4)).toMatch(/^#/)
    })

    it('undo of the delete brings it back', () => {
      const t = withData()
      const bytes = t.wb.toBytes()
      const names = t.nr.snapshot()
      deleteData(t)
      t.wb = createWorkbook({ loadBytes: bytes })
      t.nr.restore(names)
      sync(t)
      expect(range(t, 'far')).toBe('A1')
      expect(shown(t, 12, 4)).toBe('7')
      edit(t, 'deleteRows', 1)
      expect(shown(t, 11, 3)).toBe('540')
      expect(shown(t, 11, 4)).toBe('7')
    })

    // Saved before this fix: the store still points the name at the sheet.
    // IronCalc keeps a name whose sheet it deletes (an update of it is
    // taken) but refuses to create one; a workbook built without the names
    // (collab load, a converted develop sheet) has to create every name.
    const openSaved = (t, { held }) => {
      t.wb.apply(cmd(CommandTypes.deleteSheet, { sheet: 'Data' }))
      if (!held) t.wb.apply(cmd(CommandTypes.deleteDefinedName, { name: 'far' }))
      const names = t.nr.snapshot()
      t.wb = createWorkbook({ loadBytes: t.wb.toBytes() })
      t.sent = new Map()
      t.nr.restore(names)
    }

    it.each([false, true])(
      'a file saved with it opens and syncs the other names (IronCalc holds it: %s)',
      (held) => {
        const t = withData()
        openSaved(t, { held })
        t.nr.add({ name: 'ten', sheet: 'Sheet1', range: 'A10' })
        put(t, 12, 5, '=ten')
        sync(t)
        expect(shown(t, 12, 3)).toBe('550')
        expect(shown(t, 12, 5)).toBe('100')
        expect(shown(t, 12, 4)).toMatch(/^#/)
        edit(t, 'deleteRows', 1)
        expect(range(t, 'rng')).toBe('A1:A9')
        expect(shown(t, 11, 3)).toBe('540')
        expect(shown(t, 11, 5)).toBe('100')
      },
    )

    it('the store sets only that sheet’s names to #REF!', () => {
      const nr = createNamedRanges()
      nr.add({ name: 'a', sheet: 'Data', range: 'A1:B2' })
      nr.add({ name: 'b', sheet: 'Sheet1', range: 'A1' })
      let notified = 0
      nr.setOnChange(() => notified++)
      nr.deleteSheet('Other')
      expect(notified).toBe(0)
      nr.deleteSheet('Data')
      expect(nr.get('a')).toEqual({ name: 'a', sheet: 'Data', range: '#REF!' })
      expect(nr.get('b').range).toBe('A1')
      expect(notified).toBe(1)
    })
  })
})
