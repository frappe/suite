import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { describe, expect, it } from 'vitest'

import { CommandTypes } from '../core/commands.js'
import { createWorkbook } from '../core/workbook.js'
import { definedNameFormula } from './named-ranges.js'

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
