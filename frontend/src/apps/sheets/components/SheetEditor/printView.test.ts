import { describe, expect, it } from 'vitest'

import { parseCellId } from '../../utils/cells.js'
import {
  indexRuns,
  isPrintable,
  printedGrid,
  printHtml,
  type PrintableSheet,
  type PrintFormat,
} from './printView'

const BUDGET = [
  ['Item', 'Change'],
  ['Rent', '-0.2477'],
]

// A sheet of `displays` from A1, printed whole.
function fromA1(displays: string[][]) {
  return {
    rows: displays.map((_, r) => r),
    cols: (displays[0] ?? []).map((_, c) => c),
    shown: (id: string) => {
      const cell = parseCellId(id)
      return cell ? (displays[cell.row]?.[cell.col] ?? '') : ''
    },
  }
}

function sheet(overrides: Partial<PrintableSheet> = {}): PrintableSheet {
  return {
    name: 'Q4 Budget',
    ...fromA1(BUDGET),
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
      ...fromA1([
        ['Totals', ''],
        ['1', '2'],
      ]),
      mergeAt: (id) => (id === 'A1' ? { rowSpan: 1, colSpan: 2 } : null),
      isCovered: (id) => id === 'B1',
    })
    const [first, ...rest] = cells(printHtml('Budget', [merged]))
    expect(first!.colSpan).toBe(2)
    expect(rest.map((cell) => cell.textContent)).toEqual(['1', '2'])
  })

  describe('a sparse sheet', () => {
    const noMerge = () => null

    it('prints only the rows and columns that hold something', () => {
      const grid = printedGrid(
        [
          { row: 0, col: 0 },
          { row: 1048575, col: 16383 },
        ],
        noMerge,
      )
      expect(grid).toEqual({ rows: [0, 1048575], cols: [0, 16383] })
    })

    it('starts at the first data and keeps a short gap as spacing', () => {
      const grid = printedGrid(
        [
          { row: 4, col: 2 },
          { row: 6, col: 2 },
          { row: 50, col: 3 },
        ],
        noMerge,
      )
      expect(grid).toEqual({ rows: [4, 5, 6, 50], cols: [2, 3] })
    })

    it('keeps every row and column a merge spans', () => {
      const merge = (id: string) => (id === 'A1' ? { rowSpan: 2, colSpan: 8 } : null)
      expect(printedGrid([{ row: 0, col: 0 }], merge)).toEqual({
        rows: [0, 1],
        cols: [0, 1, 2, 3, 4, 5, 6, 7],
      })
    })

    it('reads blocks of neighbours, and says so when the page would be too large', () => {
      expect(indexRuns([0, 1, 2, 50, 70, 71])).toEqual([
        [0, 2],
        [50, 50],
        [70, 71],
      ])
      const rows = Array.from({ length: 200_000 }, (_, r) => r)
      const cols = [0, 1, 2]
      expect(isPrintable(rows, cols)).toBe(false)
      const html = printHtml('Budget', [sheet({ rows, cols })])
      expect(html).toContain('too large to print')
      expect(cells(html)).toEqual([])
    })
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
