import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { useFormulaAutocomplete } from './useFormulaAutocomplete.js'

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
