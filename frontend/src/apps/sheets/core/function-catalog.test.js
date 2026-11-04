import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { describe, expect, it } from 'vitest'

import { AC_FUN_KEYS } from '../utils/formula-ac.js'
import { CommandTypes } from './commands.js'
import { createWorkbook } from './workbook.js'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

// Functions the editor draws itself; IronCalc does not know them.
const EDITOR_FUNCTIONS = new Set(['SPARKLINE'])

// Autocomplete must only offer functions IronCalc evaluates: an unknown one
// computes to #NAME?, a known one called with no arguments to some other
// error or a value.
describe('function catalog', () => {
  it('lists only functions IronCalc knows', () => {
    const wb = createWorkbook()
    let seq = 0
    const unknown = AC_FUN_KEYS.filter((fn) => {
      if (EDITOR_FUNCTIONS.has(fn)) return false
      wb.apply({
        id: `f${seq++}`,
        actor: 'test',
        ts: seq,
        type: CommandTypes.setInput,
        payload: { sheet: 'Sheet1', row: 1, col: 1, input: `=${fn}()` },
      })
      return wb.getDisplayValue('Sheet1', 1, 1) === '#NAME?'
    })
    expect(unknown).toEqual([])
  })
})
