import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { AC_FUN_KEYS } from '../../utils/formula-ac.js'
import { AC_FUNS, parseAcToken, useFormulaAutocomplete } from './useFormulaAutocomplete.js'

// ── parseAcToken ──────────────────────────────────────────────────────────────

describe('parseAcToken', () => {
  it('returns null for plain text (no leading =)', () => {
    expect(parseAcToken('hello', 5)).toBeNull()
  })

  it('returns null for empty value', () => {
    expect(parseAcToken('', 0)).toBeNull()
  })

  it('extracts token at start of formula', () => {
    expect(parseAcToken('=SU', 3)).toEqual({ tok: 'SU', tokStart: 1 })
  })

  it('extracts token after opening paren', () => {
    expect(parseAcToken('=SUM(AV', 7)).toEqual({ tok: 'AV', tokStart: 5 })
  })

  it('extracts token after comma', () => {
    expect(parseAcToken('=IF(A1,TR', 9)).toEqual({ tok: 'TR', tokStart: 7 })
  })

  it('extracts token after operator', () => {
    expect(parseAcToken('=A1+RO', 6)).toEqual({ tok: 'RO', tokStart: 4 })
  })

  it('returns the token even when it looks like a cell ref (no function filter here)', () => {
    // Token extraction is permissive; updateAc will simply find no matches for 'A1'
    expect(parseAcToken('=A1', 3)).toEqual({ tok: 'A1', tokStart: 1 })
  })

  it('returns null when formula has no token at cursor', () => {
    expect(parseAcToken('=SUM(', 5)).toBeNull()
  })
})

describe('AC_FUN_KEYS', () => {
  it('is pre-sorted and matches AC_FUNS keys', () => {
    expect(AC_FUN_KEYS).toEqual(Object.keys(AC_FUNS).sort())
  })
})

// ── useFormulaAutocomplete ────────────────────────────────────────────────────

function makeAc(sheetList = []) {
  const formulaInputRef = ref(null)
  const formulaValue = ref('')
  const sheetNames = ref(sheetList)
  const ac = useFormulaAutocomplete({ formulaInputRef, formulaValue, sheetNames })
  return { ...ac, formulaInputRef, formulaValue, sheetNames }
}

describe('updateAc', () => {
  it('populates acItems with matching function names', () => {
    const { acItems, updateAc } = makeAc()
    updateAc('=SU', 3)
    const names = acItems.value.map((i) => i.name)
    expect(names).toContain('SUM')
    expect(names).toContain('SUBSTITUTE')
    expect(acItems.value.every((i) => i.kind === 'fn')).toBe(true)
  })

  it('clears acItems when no match', () => {
    const { acItems, updateAc } = makeAc()
    updateAc('=SU', 3)
    updateAc('=ZZZ', 4)
    expect(acItems.value).toHaveLength(0)
  })

  it('clears acItems when not in a formula', () => {
    const { acItems, updateAc } = makeAc()
    updateAc('hello', 5)
    expect(acItems.value).toHaveLength(0)
  })

  it('includes sheet names with kind=sheet', () => {
    const { acItems, updateAc } = makeAc(['Sales', 'Summary'])
    updateAc('=SA', 3)
    const sheets = acItems.value.filter((i) => i.kind === 'sheet')
    expect(sheets.map((i) => i.name)).toContain('Sales')
  })

  it('does not duplicate sheet names already matched as functions', () => {
    const { acItems, updateAc } = makeAc(['SUM'])
    updateAc('=SU', 3)
    const sumItems = acItems.value.filter((i) => i.name === 'SUM')
    expect(sumItems).toHaveLength(1)
  })

  it('resets acIdx to 0 on each update', () => {
    const { acIdx, updateAc } = makeAc()
    acIdx.value = 3
    updateAc('=SU', 3)
    expect(acIdx.value).toBe(0)
  })

  it('limits function results to 6', () => {
    const { acItems, updateAc } = makeAc()
    updateAc('=C', 2)
    expect(acItems.value.filter((i) => i.kind === 'fn').length).toBeLessThanOrEqual(6)
  })
})

describe('acVisible', () => {
  it('is false when acItems is empty', () => {
    const { acVisible } = makeAc()
    expect(acVisible.value).toBe(false)
  })

  it('is true when acItems has entries', () => {
    const { acVisible, updateAc } = makeAc()
    updateAc('=SU', 3)
    expect(acVisible.value).toBe(true)
  })
})

describe('closeAc', () => {
  it('clears acItems and resets acUp', () => {
    const { acItems, acUp, acVisible, closeAc, updateAc } = makeAc()
    updateAc('=SU', 3)
    acUp.value = true
    closeAc()
    expect(acVisible.value).toBe(false)
    expect(acUp.value).toBe(false)
  })
})

describe('commitAc', () => {
  it('inserts function name with auto-closed () into formulaValue', () => {
    const { commitAc, formulaValue, formulaInputRef } = makeAc()
    formulaValue.value = '=SU'
    formulaInputRef.value = { selectionStart: 3, value: '=SU', setSelectionRange: () => {} }
    commitAc({ name: 'SUM', kind: 'fn' })
    expect(formulaValue.value).toBe('=SUM()')
  })

  it('inserts sheet name with ! suffix', () => {
    const { commitAc, formulaValue, formulaInputRef } = makeAc()
    formulaValue.value = '=SA'
    formulaInputRef.value = { selectionStart: 3, value: '=SA', setSelectionRange: () => {} }
    commitAc({ name: 'Sales', kind: 'sheet' })
    expect(formulaValue.value).toBe('=Sales!')
  })

  it('clears acItems after commit', () => {
    const { commitAc, acItems, updateAc, formulaInputRef, formulaValue } = makeAc()
    updateAc('=SU', 3)
    formulaValue.value = '=SU'
    formulaInputRef.value = { selectionStart: 3, value: '=SU', setSelectionRange: () => {} }
    commitAc({ name: 'SUM', kind: 'fn' })
    expect(acItems.value).toHaveLength(0)
  })

  it('does nothing when formulaInputRef is null', () => {
    const { commitAc, formulaValue } = makeAc()
    formulaValue.value = '=SU'
    expect(() => commitAc({ name: 'SUM', kind: 'fn' })).not.toThrow()
    expect(formulaValue.value).toBe('=SU')
  })
})

describe('AC_FUNS', () => {
  it('exports the full function signature map', () => {
    expect(AC_FUNS['SUM']).toBe('(number1, ...)')
    expect(AC_FUNS['IF']).toContain('test')
    expect(AC_FUNS['VLOOKUP']).toContain('col_index')
  })
})
