import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync, Model } from '@ironcalc/wasm'
import { describe, expect, it, vi } from 'vitest'

import { CommandTypes } from './commands.js'
import { createWorkbook, WorkbookError } from './workbook.js'

// Node has no fetch-based wasm loading for the web-target package; feed the
// raw bytes to initSync instead.
const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

let seq = 0
const cmd = (type, payload) => ({ id: `c${seq++}`, actor: 'test', ts: seq, type, payload })
const setInput = (wb, sheet, row, col, input) =>
  wb.apply(cmd(CommandTypes.setInput, { sheet, row, col, input }))

describe('workbook — formulas through commands', () => {
  it('evaluates SUM over a range', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, '1')
    setInput(wb, 'Sheet1', 2, 1, '2')
    setInput(wb, 'Sheet1', 3, 1, '3')
    setInput(wb, 'Sheet1', 4, 1, '=SUM(A1:A3)')
    expect(wb.getDisplayValue('Sheet1', 4, 1)).toBe('6')
    expect(wb.getInput('Sheet1', 4, 1)).toBe('=SUM(A1:A3)')
  })

  it('duplicates a sheet under the name asked for, and reorders sheets', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, '7')
    wb.apply(cmd(CommandTypes.duplicateSheet, { sheet: 'Sheet1', name: 'Sheet1 copy' }))
    expect(wb.getSheets()).toContain('Sheet1 copy')
    expect(wb.getDisplayValue('Sheet1 copy', 1, 1)).toBe('7')
    wb.apply(cmd(CommandTypes.addSheet, { name: 'Data' }))
    wb.apply(cmd(CommandTypes.moveSheet, { sheet: 'Data', index: 0 }))
    expect(wb.getSheets()[0]).toBe('Data')
  })

  it('evaluates cross-sheet references', () => {
    const wb = createWorkbook()
    wb.apply(cmd(CommandTypes.addSheet, { name: 'Data' }))
    expect(wb.getSheets()).toEqual(['Sheet1', 'Data'])
    setInput(wb, 'Data', 1, 1, '41')
    setInput(wb, 'Sheet1', 1, 1, '=Data!A1+1')
    expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('42')
  })

  it('evaluates XLOOKUP', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, 'apple')
    setInput(wb, 'Sheet1', 2, 1, 'banana')
    setInput(wb, 'Sheet1', 1, 2, '10')
    setInput(wb, 'Sheet1', 2, 2, '20')
    setInput(wb, 'Sheet1', 1, 3, '=XLOOKUP("banana",A1:A2,B1:B2)')
    expect(wb.getDisplayValue('Sheet1', 1, 3)).toBe('20')
  })

  it('spills SEQUENCE as a dynamic array', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, '=SEQUENCE(3)')
    expect([1, 2, 3].map((r) => wb.getDisplayValue('Sheet1', r, 1))).toEqual(['1', '2', '3'])
  })

  it('pins setArrayFormula to its given dimensions', () => {
    const wb = createWorkbook()
    wb.apply(
      cmd(CommandTypes.setArrayFormula, {
        sheet: 'Sheet1',
        row: 1,
        col: 1,
        width: 2,
        height: 2,
        input: '=SEQUENCE(2,2)',
      }),
    )
    expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('1')
    expect(wb.getDisplayValue('Sheet1', 2, 2)).toBe('4')
  })

  // Like Google Sheets: typed `1,000` is the number 1000 shown as `1,000`,
  // not the text "1,000" (the old engines got this wrong).
  it('stores a number typed with thousands separators as a number', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 3, '1,000')
    setInput(wb, 'Sheet1', 2, 3, '-1,234.5')
    setInput(wb, 'Sheet1', 3, 3, '$1,000')
    setInput(wb, 'Sheet1', 1, 5, '=C1*2')
    setInput(wb, 'Sheet1', 2, 5, '=ISNUMBER(C2)')
    setInput(wb, 'Sheet1', 3, 5, '=SUM(C1:C3)=765.5')
    expect(wb.getInput('Sheet1', 1, 3)).toBe('1000')
    expect(wb.getDisplayValue('Sheet1', 1, 3)).toBe('1,000')
    expect(wb.getDisplayValue('Sheet1', 1, 5)).toBe('2,000')
    expect(wb.getDisplayValue('Sheet1', 2, 5)).toBe('TRUE')
    expect(wb.getDisplayValue('Sheet1', 3, 5)).toBe('TRUE')
    // Not a valid grouping: stays text, as in Google Sheets
    setInput(wb, 'Sheet1', 4, 3, '1,00')
    expect(wb.getInput('Sheet1', 4, 3)).toBe('1,00')
  })
})

// ISSUES #34: IronCalc gives a formula's result the format of its inputs,
// but on purpose not for a percent times a plain number (=A1*2 over 50%
// showed 1). Google Sheets shows 100%; so does the workbook now.
describe('workbook — a percent times plain numbers stays a percent', () => {
  const shown = (formula, a1 = '50%') => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, a1)
    setInput(wb, 'Sheet1', 2, 1, '200')
    setInput(wb, 'Sheet1', 3, 1, formula)
    return wb.getDisplayValue('Sheet1', 3, 1)
  }

  it('multiplies and divides by numbers', () => {
    expect(shown('=A1*2')).toBe('100%')
    expect(shown('=2*A1')).toBe('100%')
    expect(shown('=A1/2')).toBe('25%')
    expect(shown('=($A$1*3)/4')).toBe('38%')
    expect(shown('=A1*-2')).toBe('-100%')
  })

  it('keeps the decimals of the percent cell', () => {
    expect(shown('=A1*2', '12.5%')).toBe('25.00%')
  })

  it('leaves everything else to IronCalc', () => {
    expect(shown('=A1*A2')).toBe('100') // 50% of 200: a number
    expect(shown('=2/A1')).toBe('4') // a percent below the line
    expect(shown('=SUM(A1)*2')).toBe('1')
    expect(shown('=A1+10%')).toBe('60%') // IronCalc's own rule
    expect(shown('=A1*2', '0.5')).toBe('1') // not a percent
  })

  it('keeps a format the cell already has', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, '50%')
    setInput(wb, 'Sheet1', 2, 1, '$5')
    setInput(wb, 'Sheet1', 2, 1, '=A1*2')
    expect(wb.getDisplayValue('Sheet1', 2, 1)).toBe('$1')
  })

  it('reads a percent cell on another sheet', () => {
    const wb = createWorkbook()
    wb.apply(cmd(CommandTypes.addSheet, { name: 'Rates' }))
    setInput(wb, 'Rates', 1, 1, '50%')
    setInput(wb, 'Sheet1', 1, 1, '=Rates!A1*2')
    expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('100%')
  })
})

// IronCalc gives a date minus a date the date format, so the days between
// two dates showed as 1899-12-31. Google Sheets shows the number of days.
describe('workbook — days between two dates are a number', () => {
  const shown = (formula) => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, '2025-12-09')
    setInput(wb, 'Sheet1', 2, 1, '2025-12-19')
    setInput(wb, 'Sheet1', 3, 1, '5')
    setInput(wb, 'Sheet1', 4, 1, formula)
    return wb.getDisplayValue('Sheet1', 4, 1)
  }

  it('shows the days between two date cells', () => {
    expect(shown('=A2-A1')).toBe('10')
    expect(shown('=$A$1-A2')).toBe('-10')
  })

  it('works with date functions', () => {
    expect(shown('=DATE(2025,12,19)-A1')).toBe('10')
    expect(shown('=A2-DATE(2025,12,9)')).toBe('10')
    expect(Number(shown('=TODAY()-A1'))).toBeGreaterThan(300)
  })

  it('keeps a date plus or minus a number a date', () => {
    expect(shown('=A1-7')).toBe('2025-12-02')
    expect(shown('=A1+30')).toBe('2026-01-08')
    expect(shown('=A2-A3')).toBe('2025-12-14')
  })
})

// IronCalc reads `$` and `€` amounts as numbers but not `₹` or `£`, which
// stayed text (and =A1*2 gave #VALUE!).
describe('workbook — ₹ and £ amounts are numbers', () => {
  const typed = (input) => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, input)
    setInput(wb, 'Sheet1', 1, 2, '=A1*2')
    return [wb.getDisplayValue('Sheet1', 1, 1), wb.getDisplayValue('Sheet1', 1, 2)]
  }

  it('reads a rupee amount', () => {
    expect(typed('₹2')).toEqual(['₹2', '₹4'])
    expect(typed('₹1,234.5')).toEqual(['₹1,234.50', '₹2,469.00'])
    expect(typed('-₹3')).toEqual(['-₹3', '-₹6'])
    expect(typed('₹ 50')).toEqual(['₹50', '₹100'])
  })

  it('reads Indian digit grouping after a rupee sign', () => {
    expect(typed('₹1,50,000')[1]).toBe('₹300,000')
  })

  it('reads a pound amount', () => {
    expect(typed('£9.99')).toEqual(['£9.99', '£19.98'])
  })

  it('leaves text with a rupee sign alone', () => {
    expect(typed('₹ per kg')[0]).toBe('₹ per kg')
    expect(typed('₹2 each')[0]).toBe('₹2 each')
  })
})

describe('workbook — structure ops', () => {
  it('insertRows adjusts references', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, '12')
    setInput(wb, 'Sheet1', 2, 1, '=A1*2')
    wb.apply(cmd(CommandTypes.insertRows, { sheet: 'Sheet1', row: 1, count: 1 }))
    expect(wb.getInput('Sheet1', 3, 1)).toBe('=A2*2')
    expect(wb.getDisplayValue('Sheet1', 3, 1)).toBe('24')
  })

  it('applies row heights, column widths, frozen panes, and styles', () => {
    const wb = createWorkbook()
    wb.apply(cmd(CommandTypes.setColumnsWidth, { sheet: 'Sheet1', c1: 2, c2: 3, width: 120 }))
    wb.apply(cmd(CommandTypes.setRowsHeight, { sheet: 'Sheet1', r1: 5, r2: 5, height: 44 }))
    wb.apply(cmd(CommandTypes.setFrozen, { sheet: 'Sheet1', rows: 2, cols: 1 }))
    wb.apply(
      cmd(CommandTypes.setRangeStyle, {
        sheet: 'Sheet1',
        range: { r1: 1, c1: 1, r2: 2, c2: 2 },
        style: { 'font.b': true, 'fill.color': '#FFEE00' },
      }),
    )
    expect(wb.getColumnWidth('Sheet1', 3)).toBe(120)
    expect(wb.getRowHeight('Sheet1', 5)).toBe(44)
    expect(wb.getFrozen('Sheet1')).toEqual({ rows: 2, cols: 1 })
    const style = wb.getStyle('Sheet1', 2, 2).style
    expect(style.font.b).toBe(true)
    expect(style.fill.color).toBe('#FFEE00')
  })

  it('clears contents and moves rows', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, 'a')
    setInput(wb, 'Sheet1', 2, 1, 'b')
    wb.apply(cmd(CommandTypes.moveRows, { sheet: 'Sheet1', row: 1, count: 1, delta: 1 }))
    expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('b')
    expect(wb.getDisplayValue('Sheet1', 2, 1)).toBe('a')
    wb.apply(
      cmd(CommandTypes.clearContents, { sheet: 'Sheet1', range: { r1: 1, c1: 1, r2: 2, c2: 1 } }),
    )
    expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('')
    expect(wb.getDisplayValue('Sheet1', 2, 1)).toBe('')
  })

  it('renames, duplicates, and deletes sheets by name', () => {
    const wb = createWorkbook()
    wb.apply(cmd(CommandTypes.renameSheet, { sheet: 'Sheet1', name: 'Main' }))
    wb.apply(cmd(CommandTypes.duplicateSheet, { sheet: 'Main' }))
    expect(wb.getSheets()).toEqual(['Main', 'Main (1)'])
    wb.apply(cmd(CommandTypes.deleteSheet, { sheet: 'Main (1)' }))
    expect(wb.getSheets()).toEqual(['Main'])
  })

  it('upserts and deletes defined names', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, '5')
    wb.apply(cmd(CommandTypes.setDefinedName, { name: 'TAX', formula: 'Sheet1!$A$1' }))
    setInput(wb, 'Sheet1', 1, 2, '=TAX*2')
    expect(wb.getDisplayValue('Sheet1', 1, 2)).toBe('10')
    setInput(wb, 'Sheet1', 2, 1, '7')
    wb.apply(cmd(CommandTypes.setDefinedName, { name: 'TAX', formula: 'Sheet1!$A$2' }))
    expect(wb.getDisplayValue('Sheet1', 1, 2)).toBe('14')
    wb.apply(cmd(CommandTypes.deleteDefinedName, { name: 'TAX' }))
    setInput(wb, 'Sheet1', 1, 3, '=TAX')
    expect(wb.getDisplayValue('Sheet1', 1, 3)).toBe('#NAME?')
  })
})

// ISSUES #9: IronCalc turns a range end inside the deleted rows into #REF!
// (=SUM(#REF!:A9)). Like Excel and Google Sheets, the range should shrink.
describe('workbook — deleting rows or columns shrinks the ranges that span them', () => {
  const tens = (wb, sheet = 'Sheet1') => {
    for (let r = 1; r <= 10; r++) setInput(wb, sheet, r, 1, String(r * 10))
  }
  const del = (wb, type, sheet, at, count = 1) =>
    wb.apply(
      cmd(CommandTypes[type], {
        sheet,
        count,
        ...(type === 'deleteRows' ? { row: at } : { col: at }),
      }),
    )

  it('deleting a range’s first row keeps the rest (the reported case)', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, '10')
    setInput(wb, 'Sheet1', 2, 1, '20')
    setInput(wb, 'Sheet1', 3, 2, '=AVERAGE(A1:A10)')
    expect(wb.getDisplayValue('Sheet1', 3, 2)).toBe('15')
    del(wb, 'deleteRows', 'Sheet1', 1)
    expect(wb.getInput('Sheet1', 2, 2)).toBe('=AVERAGE(A1:A9)')
    expect(wb.getDisplayValue('Sheet1', 2, 2)).toBe('20')
  })

  it('deleting the last rows or middle rows of a range', () => {
    const wb = createWorkbook()
    tens(wb)
    setInput(wb, 'Sheet1', 1, 3, '=SUM(A1:A10)')
    setInput(wb, 'Sheet1', 1, 4, '=SUM($A$4:$A$10)')
    del(wb, 'deleteRows', 'Sheet1', 9, 3)
    expect(wb.getInput('Sheet1', 1, 3)).toBe('=SUM(A1:A8)')
    expect(wb.getDisplayValue('Sheet1', 1, 3)).toBe('360')
    del(wb, 'deleteRows', 'Sheet1', 3, 2)
    expect(wb.getInput('Sheet1', 1, 3)).toBe('=SUM(A1:A6)')
    expect(wb.getInput('Sheet1', 1, 4)).toBe('=SUM($A$3:$A$6)')
    expect(wb.getDisplayValue('Sheet1', 1, 4)).toBe('260')
  })

  it('deleting every row of a range is still an error', () => {
    const wb = createWorkbook()
    tens(wb)
    setInput(wb, 'Sheet1', 1, 3, '=SUM(A2:A3)')
    del(wb, 'deleteRows', 'Sheet1', 2, 2)
    expect(wb.getInput('Sheet1', 1, 3)).toContain('#REF!')
    expect(wb.getDisplayValue('Sheet1', 1, 3)).toMatch(/^#/)
  })

  it('deleting a range’s first column', () => {
    const wb = createWorkbook()
    for (let c = 1; c <= 3; c++) setInput(wb, 'Sheet1', 1, c, String(c))
    setInput(wb, 'Sheet1', 2, 5, '=SUM(A1:C1)')
    del(wb, 'deleteColumns', 'Sheet1', 1)
    expect(wb.getInput('Sheet1', 2, 4)).toBe('=SUM(A1:B1)')
    expect(wb.getDisplayValue('Sheet1', 2, 4)).toBe('5')
  })

  it('a range on another sheet shrinks and keeps its sheet name', () => {
    const wb = createWorkbook()
    wb.apply(cmd(CommandTypes.addSheet, { name: 'My data' }))
    tens(wb, 'My data')
    setInput(wb, 'Sheet1', 1, 2, "=SUM('My data'!A1:A10)")
    del(wb, 'deleteRows', 'My data', 1)
    expect(wb.getInput('Sheet1', 1, 2)).toBe("=SUM('My data'!A1:A9)")
    expect(wb.getDisplayValue('Sheet1', 1, 2)).toBe('540')
  })

  it('keeps the rewritten cell’s format and counts as one version', () => {
    const wb = createWorkbook()
    tens(wb)
    setInput(wb, 'Sheet1', 11, 2, '=SUM(A1:A10)')
    wb.apply(
      cmd(CommandTypes.setRangeStyle, {
        sheet: 'Sheet1',
        range: { r1: 11, c1: 2, r2: 11, c2: 2 },
        style: { 'font.b': true },
      }),
    )
    const before = wb.getVersion()
    del(wb, 'deleteRows', 'Sheet1', 1)
    expect(wb.getVersion()).toBe(before + 1)
    expect(wb.getStyle('Sheet1', 10, 2).style.font.b).toBe(true)
    expect(wb.getDisplayValue('Sheet1', 10, 2)).toBe('540')
  })

  // IronCalc won't write over an array formula's cells; the rewrite clears it first.
  it('rewrites an array formula', () => {
    const wb = createWorkbook()
    tens(wb)
    wb.apply(
      cmd(CommandTypes.setArrayFormula, {
        sheet: 'Sheet1',
        row: 5,
        col: 3,
        width: 1,
        height: 2,
        input: '=A1:A2*1',
      }),
    )
    del(wb, 'deleteRows', 'Sheet1', 1)
    expect(wb.getInput('Sheet1', 4, 3)).toBe('=A1:A1*1')
    expect(wb.getDisplayValue('Sheet1', 4, 3)).toBe('20')
  })

  // The formula scan stops at the lowest row a formula can be on (a bound
  // the workbook keeps); each way a formula gets below it must still be seen.
  describe('finds every formula', () => {
    // A1:A10 = 10..100, B20 = SUM(A1:A10); one delete makes the bound exact.
    const start = () => {
      const wb = createWorkbook()
      tens(wb)
      setInput(wb, 'Sheet1', 20, 2, '=SUM(A1:A10)')
      del(wb, 'deleteRows', 'Sheet1', 12)
      expect(wb.getInput('Sheet1', 19, 2)).toBe('=SUM(A1:A10)')
      return wb
    }
    const deleteFirstRow = (wb, row) => {
      del(wb, 'deleteRows', 'Sheet1', 1)
      expect(wb.getInput('Sheet1', row, 2)).toBe('=SUM(A1:A9)')
    }

    it('far down', () => {
      const wb = createWorkbook()
      tens(wb)
      setInput(wb, 'Sheet1', 500000, 2, '=SUM(A1:A10)')
      deleteFirstRow(wb, 499999)
    })

    it('pushed down by inserted rows', () => {
      const wb = start()
      wb.apply(cmd(CommandTypes.insertRows, { sheet: 'Sheet1', row: 15, count: 1000 }))
      deleteFirstRow(wb, 1018)
    })

    it('moved down', () => {
      const wb = start()
      wb.apply(cmd(CommandTypes.moveRows, { sheet: 'Sheet1', row: 19, count: 1, delta: 100 }))
      deleteFirstRow(wb, 118)
    })

    // Moving rows 25–34 up by 10 pushes rows 15–24 down by 10.
    it('pushed down by rows moved up past it', () => {
      const wb = start()
      wb.apply(cmd(CommandTypes.moveRows, { sheet: 'Sheet1', row: 25, count: 10, delta: -10 }))
      expect(wb.getInput('Sheet1', 29, 2)).toBe('=SUM(A1:A10)')
      deleteFirstRow(wb, 28)
    })

    it('brought back down by undo', () => {
      const wb = start()
      del(wb, 'deleteRows', 'Sheet1', 12, 5)
      expect(wb.getInput('Sheet1', 14, 2)).toBe('=SUM(A1:A10)')
      wb.undo()
      wb.undo()
      deleteFirstRow(wb, 19)
    })

    it('loaded from bytes', () => {
      const loaded = createWorkbook({ loadBytes: start().toBytes() })
      deleteFirstRow(loaded, 18)
    })
  })

  it('inside a batch, with more edits after it', () => {
    const wb = createWorkbook()
    tens(wb)
    setInput(wb, 'Sheet1', 11, 2, '=SUM(A1:A10)')
    wb.apply(
      cmd(CommandTypes.batch, {
        commands: [
          cmd(CommandTypes.deleteRows, { sheet: 'Sheet1', row: 1, count: 1 }),
          cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 1, col: 1, input: '1' }),
        ],
      }),
    )
    expect(wb.getInput('Sheet1', 10, 2)).toBe('=SUM(A1:A9)')
    expect(wb.getDisplayValue('Sheet1', 10, 2)).toBe('521')
  })

  it('puts the formulas back when IronCalc refuses the delete', () => {
    const wb = createWorkbook()
    tens(wb)
    wb.apply(
      cmd(CommandTypes.setArrayFormula, {
        sheet: 'Sheet1',
        row: 1,
        col: 3,
        width: 1,
        height: 2,
        input: '=A1:A2*1',
      }),
    )
    setInput(wb, 'Sheet1', 1, 4, '=SUM(A2:A10)')
    expect(() => del(wb, 'deleteRows', 'Sheet1', 2)).toThrow(WorkbookError)
    expect(wb.getInput('Sheet1', 1, 4)).toBe('=SUM(A2:A10)')
    expect(wb.getDisplayValue('Sheet1', 1, 4)).toBe('540')
  })
})

describe('workbook — versioning and errors', () => {
  it('bumps the version once per applied command', () => {
    const wb = createWorkbook()
    expect(wb.getVersion()).toBe(0)
    expect(setInput(wb, 'Sheet1', 1, 1, '1')).toEqual({ version: 1 })
    expect(setInput(wb, 'Sheet1', 2, 1, '2')).toEqual({ version: 2 })
  })

  it('a failed command throws WorkbookError and does not bump the version', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, '1')
    const bad = cmd(CommandTypes.setInput, { sheet: 'Nope', row: 1, col: 1, input: '1' })
    let caught
    try {
      wb.apply(bad)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(WorkbookError)
    expect(caught.command).toBe(bad)
    expect(caught.message).toMatch(/unknown sheet "Nope"/)
    expect(wb.getVersion()).toBe(1)
  })

  it('an invalid command shape also leaves the version alone', () => {
    const wb = createWorkbook()
    expect(() =>
      wb.apply(cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 0, col: 1, input: '1' })),
    ).toThrow(WorkbookError)
    expect(wb.getVersion()).toBe(0)
  })

  it('batch counts as one version and rolls back atomically on failure', () => {
    const wb = createWorkbook()
    wb.apply(
      cmd(CommandTypes.batch, {
        commands: [
          cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 1, col: 1, input: '1' }),
          cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 2, col: 1, input: '2' }),
          cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 3, col: 1, input: '=A1+A2' }),
        ],
      }),
    )
    expect(wb.getVersion()).toBe(1)
    expect(wb.getDisplayValue('Sheet1', 3, 1)).toBe('3')

    const failing = cmd(CommandTypes.batch, {
      commands: [
        cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 1, col: 2, input: 'x' }),
        cmd(CommandTypes.setInput, { sheet: 'Nope', row: 1, col: 1, input: 'y' }),
      ],
    })
    expect(() => wb.apply(failing)).toThrow(WorkbookError)
    expect(wb.getVersion()).toBe(1)
    // The first sub-command must not stick: the pre-batch snapshot wins.
    expect(wb.getDisplayValue('Sheet1', 1, 2)).toBe('')
    expect(wb.getDisplayValue('Sheet1', 3, 1)).toBe('3')
  })

  it('undo/redo round trip', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 1, 'hello')
    expect(wb.canUndo()).toBe(true)
    expect(wb.canRedo()).toBe(false)
    expect(wb.undo()).toEqual({ version: 2 })
    expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('')
    expect(wb.canRedo()).toBe(true)
    expect(wb.redo()).toEqual({ version: 3 })
    expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('hello')
    // No-op when there is nothing left to redo.
    expect(wb.redo()).toEqual({ version: 3 })
  })
})

// usedCells and findInputs stop at the lowest row an input can be on (a bound
// the workbook keeps, ISSUES #81), plus where a spill or array reaches below
// it; each way a cell gets below the bound must still be listed.
describe('workbook — the cell scans stop at the last used row', () => {
  const rowsOf = (cells) => cells.filter((_, i) => i % 2 === 0)
  const used = (wb, sheet = 'Sheet1') => rowsOf(wb.usedCells(sheet))
  const rowReads = (fn) => {
    const spy = vi.spyOn(Model.prototype, 'getColumnsWithData')
    try {
      fn()
      return spy.mock.calls.length
    } finally {
      spy.mockRestore()
    }
  }

  it('reads the used rows, not all 1,048,576', () => {
    const wb = createWorkbook()
    for (let r = 1; r <= 3; r++) setInput(wb, 'Sheet1', r, 1, String(r))
    expect(rowReads(() => expect(used(wb)).toEqual([1, 2, 3]))).toBeLessThanOrEqual(3)
  })

  it('reads the used rows of a loaded workbook', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 40, 1, '1')
    const loaded = createWorkbook({ loadBytes: wb.toBytes() })
    expect(rowReads(() => expect(used(loaded)).toEqual([40]))).toBeLessThanOrEqual(40)
  })

  it('far down, and on another sheet', () => {
    const wb = createWorkbook()
    wb.apply(cmd(CommandTypes.addSheet, { name: 'Data' }))
    setInput(wb, 'Data', 500000, 2, 'far')
    expect(used(wb, 'Data')).toEqual([500000])
    expect(used(wb)).toEqual([])
    expect(wb.findInputs('Data', 'far', 10)).toEqual([{ row: 500000, col: 2, input: 'far' }])
  })

  it('pushed down by inserted rows, or moved down', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 5, 1, 'a')
    wb.apply(cmd(CommandTypes.insertRows, { sheet: 'Sheet1', row: 1, count: 1000 }))
    expect(used(wb)).toEqual([1005])
    wb.apply(cmd(CommandTypes.moveRows, { sheet: 'Sheet1', row: 1005, count: 1, delta: 100 }))
    expect(used(wb)).toEqual([1105])
  })

  // Moving rows 11–20 up by 10 pushes rows 1–10 down by 10.
  it('pushed down by rows moved up past it', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 10, 1, 'a')
    wb.apply(cmd(CommandTypes.moveRows, { sheet: 'Sheet1', row: 11, count: 10, delta: -10 }))
    expect(used(wb)).toEqual([20])
  })

  it('brought back down by undo, in a loaded workbook', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 900, 1, 'a')
    const loaded = createWorkbook({ loadBytes: wb.toBytes() })
    loaded.apply(cmd(CommandTypes.deleteRows, { sheet: 'Sheet1', row: 1, count: 100 }))
    expect(used(loaded)).toEqual([800])
    loaded.undo()
    expect(used(loaded)).toEqual([900])
  })

  it('inside a batch (a paste)', () => {
    const wb = createWorkbook()
    wb.apply(
      cmd(CommandTypes.batch, {
        commands: [
          cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 1, col: 1, input: '1' }),
          cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 300, col: 1, input: '2' }),
        ],
      }),
    )
    expect(used(wb)).toEqual([1, 300])
  })

  it('an array formula’s cells', () => {
    const wb = createWorkbook()
    wb.apply(
      cmd(CommandTypes.setArrayFormula, {
        sheet: 'Sheet1',
        row: 1,
        col: 1,
        width: 1,
        height: 3,
        input: '=ROW(A1:A3)',
      }),
    )
    expect(used(wb)).toEqual([1, 2, 3])
  })

  // The spill grows when E1 changes, though nothing is typed below row 1.
  it('a spill, as it grows', () => {
    const wb = createWorkbook()
    setInput(wb, 'Sheet1', 1, 5, '3')
    setInput(wb, 'Sheet1', 1, 3, '=SEQUENCE(E1)')
    expect(used(wb)).toEqual([1, 1, 2, 3])
    setInput(wb, 'Sheet1', 1, 5, '5000')
    expect(used(wb).at(-1)).toBe(5000)
    expect(wb.findInputs('Sheet1', '4999', 10)).toEqual([{ row: 4999, col: 3, input: '4999' }])
  })
})

describe('workbook — snapshots', () => {
  it('round-trips through toBytes/loadBytes', () => {
    const wb = createWorkbook()
    wb.apply(cmd(CommandTypes.addSheet, { name: 'Data' }))
    setInput(wb, 'Data', 1, 1, '3')
    setInput(wb, 'Sheet1', 1, 1, '=Data!A1^2')
    const copy = createWorkbook({ loadBytes: wb.toBytes() })
    expect(copy.getSheets()).toEqual(['Sheet1', 'Data'])
    expect(copy.getDisplayValue('Sheet1', 1, 1)).toBe('9')
    expect(copy.getInput('Sheet1', 1, 1)).toBe('=Data!A1^2')
    expect(copy.getVersion()).toBe(0)
  })
})

// ── Determinism / convergence ───────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Seeded log of ~200 commands across values, formulas, styles, row/column
// ops, sheet ops, and batches. The generator tracks live sheet names so
// every command addresses an existing sheet.
function generateLog(seed, n = 200) {
  const rand = mulberry32(seed)
  const int = (max) => 1 + Math.floor(rand() * max)
  const pick = (arr) => arr[Math.floor(rand() * arr.length)]
  const sheets = ['Sheet1']
  const log = []
  let id = 0
  const make = (type, payload) => ({ id: `g${id}`, actor: 'gen', ts: id++, type, payload })
  const push = (type, payload) => log.push(make(type, payload))

  for (let i = 0; i < n; i++) {
    const sheet = pick(sheets)
    const r = rand()
    if (r < 0.32) {
      push(CommandTypes.setInput, { sheet, row: int(20), col: int(8), input: String(int(1000)) })
    } else if (r < 0.5) {
      push(CommandTypes.setInput, {
        sheet,
        row: int(20),
        col: int(8),
        input: `=SUM(A1:B5)+${int(9)}`,
      })
    } else if (r < 0.62) {
      const r1 = int(15),
        c1 = int(6)
      push(CommandTypes.setRangeStyle, {
        sheet,
        range: { r1, c1, r2: r1 + int(3), c2: c1 + int(2) },
        style: pick([
          { 'font.b': true },
          { 'font.i': true },
          { 'fill.color': '#D0E8FF' },
          { num_fmt: '0.00' },
        ]),
      })
    } else if (r < 0.69) {
      push(CommandTypes.insertRows, { sheet, row: int(10), count: 1 })
    } else if (r < 0.75) {
      push(CommandTypes.deleteRows, { sheet, row: int(10), count: 1 })
    } else if (r < 0.79) {
      push(CommandTypes.insertColumns, { sheet, col: int(6), count: 1 })
    } else if (r < 0.83) {
      const c1 = int(8)
      push(CommandTypes.setColumnsWidth, { sheet, c1, c2: c1, width: 40 + int(80) })
    } else if (r < 0.87) {
      push(CommandTypes.clearContents, { sheet, range: { r1: int(10), c1: int(4), r2: 12, c2: 6 } })
    } else if (r < 0.9 && sheets.length < 5) {
      const name = `Gen${id}`
      sheets.push(name)
      push(CommandTypes.addSheet, { name })
    } else if (r < 0.93 && sheets.length > 1) {
      const victim = sheets.splice(1 + Math.floor(rand() * (sheets.length - 1)), 1)[0]
      push(CommandTypes.deleteSheet, { sheet: victim })
    } else if (r < 0.96) {
      push(CommandTypes.setFrozen, { sheet, rows: int(3), cols: int(2) })
    } else {
      push(CommandTypes.batch, {
        commands: [
          make(CommandTypes.setInput, { sheet, row: int(20), col: int(8), input: String(int(99)) }),
          make(CommandTypes.setInput, { sheet, row: int(20), col: int(8), input: `=A1+${int(9)}` }),
        ],
      })
    }
  }
  return log
}

function applyLog(wb, log) {
  // Failures must be deterministic too, so record them instead of throwing.
  return log.map((c) => {
    try {
      return `v${wb.apply(c).version}`
    } catch (e) {
      return `err:${e.message}`
    }
  })
}

function snapshotState(wb) {
  const state = { sheets: wb.getSheets(), cells: {}, styles: {}, frozen: {} }
  for (const sheet of state.sheets) {
    state.frozen[sheet] = wb.getFrozen(sheet)
    for (let row = 1; row <= 30; row++) {
      for (let col = 1; col <= 12; col++) {
        const value = wb.getDisplayValue(sheet, row, col)
        const input = wb.getInput(sheet, row, col)
        if (value !== '' || input !== '')
          state.cells[`${sheet}!${row},${col}`] = `${input}→${value}`
      }
    }
    for (let row = 1; row <= 20; row++) {
      for (let col = 1; col <= 8; col++) {
        const s = wb.getStyle(sheet, row, col).style
        if (s.font.b || s.font.i || s.fill.color || s.num_fmt !== 'general') {
          state.styles[`${sheet}!${row},${col}`] = [
            s.font.b,
            s.font.i,
            s.fill.color,
            s.num_fmt,
          ].join('|')
        }
      }
    }
  }
  return state
}

describe('workbook — determinism', () => {
  it('the same command log converges on two fresh workbooks', () => {
    const log = generateLog(1337, 200)
    const a = createWorkbook()
    const b = createWorkbook()
    expect(applyLog(b, log)).toEqual(applyLog(a, log))
    expect(b.getSheets()).toEqual(a.getSheets())
    expect(snapshotState(b)).toEqual(snapshotState(a))
    // toBytes() is NOT byte-deterministic: two models built from the same
    // calls serialise differently (verified against @ironcalc/wasm 0.8.4),
    // so convergence is asserted at the value level above.
  })

  it('a snapshot loaded from bytes matches the source workbook', () => {
    const log = generateLog(42, 120)
    const wb = createWorkbook()
    applyLog(wb, log)
    const copy = createWorkbook({ loadBytes: wb.toBytes() })
    expect(snapshotState(copy)).toEqual(snapshotState(wb))
  })
})
