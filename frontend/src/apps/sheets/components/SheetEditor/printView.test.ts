import { describe, expect, it } from 'vitest'

import { printHtml, type PrintableSheet, type PrintFormat } from './printView'

function sheet(overrides: Partial<PrintableSheet> = {}): PrintableSheet {
  return {
    name: 'Q4 Budget',
    displays: [
      ['Item', 'Change'],
      ['Rent', '-0.2477'],
    ],
    numbers: new Set(['B2']),
    format: () => ({}),
    mergeAt: () => null,
    isCovered: () => false,
    ...overrides,
  }
}

function cells(html: string) {
  const page = new DOMParser().parseFromString(html, 'text/html')
  return [...page.querySelectorAll('td')]
}

describe('Sheets: the print view', () => {
  it('shows numbers in their number format, right-aligned', () => {
    const formats: Record<string, PrintFormat> = { B2: { numberFormat: 'percentage' } }
    const html = printHtml('Budget', [sheet({ format: (id) => formats[id] ?? {} })])
    const change = cells(html)[3]!
    expect(change.textContent).toBe('-24.77%')
    expect(change.style.textAlign).toBe('right')
    expect(cells(html)[2]!.style.textAlign).toBe('left')
  })

  it('paints the fill a conditional format gives the value', () => {
    const format = (_id: string, value: string) =>
      Number(value) < 0 ? { backgroundColor: 'rgb(255, 0, 0)' } : {}
    const change = cells(printHtml('Budget', [sheet({ format })]))[3]!
    expect(change.style.background).toBe('rgb(255, 0, 0)')
  })

  it('prints a merge as one cell', () => {
    const merged = sheet({
      displays: [
        ['Totals', ''],
        ['1', '2'],
      ],
      mergeAt: (id) => (id === 'A1' ? { rowSpan: 1, colSpan: 2 } : null),
      isCovered: (id) => id === 'B1',
    })
    const [first, ...rest] = cells(printHtml('Budget', [merged]))
    expect(first!.colSpan).toBe(2)
    expect(rest.map((cell) => cell.textContent)).toEqual(['1', '2'])
  })

  it('prints every sheet given, each under its name', () => {
    const page = new DOMParser().parseFromString(
      printHtml('Budget', [sheet(), sheet({ name: 'Headcount' })]),
      'text/html',
    )
    expect([...page.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Q4 Budget',
      'Headcount',
    ])
  })
})
