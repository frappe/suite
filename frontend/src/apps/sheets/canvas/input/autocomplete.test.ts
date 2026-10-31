import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAutocomplete, type AutocompleteOptions } from './autocomplete.js'
import type { PickRect } from './range-picker.js'

// The editor sits at A3; A1 and A2 hold numbers, so =SUM( suggests A1:A2.
function setup(over: Partial<AutocompleteOptions> = {}) {
  const parent = document.createElement('div')
  const input = document.createElement('textarea')
  parent.appendChild(input)
  document.body.appendChild(parent)
  const shown: (PickRect | null)[] = []
  let suggesting = false
  const picker = {
    showSuggestion: (r: PickRect) => {
      suggesting = true
      shown.push(r)
    },
    dropSuggestion: () => {
      const was = suggesting
      suggesting = false
      return was
    },
    acceptSuggestion: vi.fn(),
  }
  const onInput = vi.fn()
  const cells: Record<string, string> = { '0,0': '10', '1,0': '20' }
  const ac = createAutocomplete({
    parent,
    input,
    picker,
    activeCell: () => ({ r: 2, c: 0 }),
    displayAt: (r, c) => cells[`${r},${c}`],
    sheetNames: () => ['Summary', 'Sales'],
    crossSheetName: () => null,
    onInput,
    render: () => {},
    ...over,
  })
  const type = (value: string) => {
    input.value = value
    input.setSelectionRange(value.length, value.length)
    ac.update(value, value.length)
  }
  const key = (k: string) => {
    const e = new KeyboardEvent('keydown', { key: k, cancelable: true })
    return ac.handleKey(e)
  }
  const popup = () => parent.querySelector('div') as HTMLDivElement
  return { ac, input, type, key, popup, picker, shown, onInput }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('autocomplete', () => {
  it('lists matching functions, then matching sheets', () => {
    const { ac, type } = setup()
    type('=SU')
    const names = ac.items.map((i) => i.name)
    expect(names).toContain('SUM')
    expect(names.every((n) => n.toUpperCase().startsWith('SU'))).toBe(true)
    expect(ac.items.some((i) => i.kind === 'sheet' && i.name === 'Summary')).toBe(true)
  })

  it('Tab accepts a function with () and the caret inside', () => {
    const { ac, input, type, key, onInput } = setup()
    type('=SUMI')
    expect(ac.items[0]?.name).toBe('SUMIF')
    expect(key('Tab')).toBe(true)
    expect(input.value).toBe('=SUMIF()')
    expect(input.selectionStart).toBe(7)
    expect(onInput).toHaveBeenLastCalledWith('=SUMIF()')
  })

  it('Down moves the highlight; keys pass through when nothing is listed', () => {
    const { type, key } = setup()
    type('=1+')
    expect(key('ArrowDown')).toBe(false)
    type('=SU')
    expect(key('ArrowDown')).toBe(true)
  })

  it('suggests the numbers above for an empty SUM argument, accepted on Tab only', () => {
    const { ac, input, type, key, picker, shown } = setup()
    type('=SUM(')
    expect(ac.items).toEqual([
      { kind: 'range', name: 'A1:A2', rect: { r0: 0, c0: 0, r1: 1, c1: 0 } },
    ])
    expect(shown).toHaveLength(1)
    expect(key('Enter')).toBe(false) // Enter still commits the formula
    expect(key('Tab')).toBe(true)
    expect(input.value).toBe('=SUM(A1:A2')
    expect(picker.acceptSuggestion).toHaveBeenCalledWith({ r0: 0, c0: 0, r1: 1, c1: 0 })
  })

  it('shows parameter help inside a call, without capturing keys', () => {
    const { ac, type, key, popup } = setup()
    type('=IF(A1>2,')
    expect(ac.items).toHaveLength(0)
    expect(popup().textContent).toContain('IF(')
    expect(key('Enter')).toBe(false)
  })

  it('Escape hides the popup', () => {
    const { ac, type, key, popup } = setup()
    type('=SU')
    expect(key('Escape')).toBe(true)
    expect(ac.items).toHaveLength(0)
    expect(popup().style.display).toBe('none')
  })
})
