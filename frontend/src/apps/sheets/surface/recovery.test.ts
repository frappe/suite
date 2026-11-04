import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { read } from 'xlsx'

import { bytesToBase64 } from '../core/snapshot-codec'
import { createWorkbook } from '../core/workbook'
import { downloadRecovery, keepRecovery, readRecovery, recoveryFile } from './recovery'

// Node cannot fetch the web-target WASM module. Initialize it from its bytes.
const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

/** A workbook as `sheets_data` stores it: packed rows, 0-based. */
const workbook = JSON.stringify({
  sheet: {
    v: 2,
    current: 'Budget',
    sheets: {
      Budget: {
        rows: { '0': ['Item', 'Cost'], '1': ['Rent', '1200'], '2': ['Total', '=SUM(B2:B2)'] },
      },
      Notes: { rows: { '0': ['typed but not committed'] } },
    },
  },
  formats: {},
})

beforeEach(() => localStorage.clear())

describe('Sheets recovery copy', () => {
  it('keeps the latest copy per spreadsheet and reads it back', () => {
    keepRecovery('node-1', '{}', new Date('2026-09-29T10:00:00Z'))
    keepRecovery('node-1', workbook, new Date('2026-09-29T10:05:00Z'))
    keepRecovery('node-2', '{}')

    expect(readRecovery('node-1')).toEqual({ savedAt: '2026-09-29T10:05:00.000Z', workbook })
    expect(readRecovery('node-3')).toBeNull()
  })

  it('ignores a copy it cannot read', () => {
    localStorage.setItem('suite:sheets-recovery:node-1', 'not json')
    expect(readRecovery('node-1')).toBeNull()
  })

  it('offers the copy as an Excel workbook with every sheet, value and formula', async () => {
    const file = await recoveryFile(
      { savedAt: '2026-09-29T10:05:00.000Z', workbook },
      'Q3 <budget>',
    )

    expect(file.name).toBe('Q3 budget (recovered).xlsx')
    const book = read(await file.arrayBuffer())
    expect(book.SheetNames).toEqual(['Budget', 'Notes'])
    const budget = book.Sheets.Budget!
    expect(budget.A1?.v).toBe('Item')
    expect(budget.B2?.v).toBe(1200)
    expect(budget.B3?.f).toBe('SUM(B2:B2)')
    expect(book.Sheets.Notes!.A1?.v).toBe('typed but not committed')
  })

  it('recovers engine snapshots with formulas, every sheet and the edit still being typed', async () => {
    const source = createWorkbook()
    source.apply({
      id: 'sheet',
      actor: 'test',
      ts: 1,
      type: 'addSheet',
      payload: { name: 'Notes' },
    })
    for (const [index, cell] of [
      { sheet: 'Sheet1', row: 1, col: 1, input: 'Budget' },
      { sheet: 'Sheet1', row: 2, col: 2, input: '1200' },
      { sheet: 'Sheet1', row: 3, col: 2, input: '=SUM(B2:B2)' },
      { sheet: 'Sheet1', row: 4, col: 27, input: 'Far column' },
      { sheet: 'Notes', row: 1, col: 1, input: 'Before typing' },
    ].entries()) {
      source.apply({
        id: `cell-${index}`,
        actor: 'test',
        ts: 2 + index,
        type: 'setInput',
        payload: cell,
      })
    }
    const workbook = JSON.stringify({
      engine: bytesToBase64(source.toBytes()),
      engine_version: '0.9.0',
      draft: { sheet: 'Notes', cell: 'A1', value: 'Still typing' },
    })

    const file = await recoveryFile(keepRecovery('engine', workbook), 'Budget')
    const book = read(await file.arrayBuffer())

    expect(book.SheetNames).toEqual(['Sheet1', 'Notes'])
    expect(book.Sheets.Sheet1!.A1?.v).toBe('Budget')
    expect(book.Sheets.Sheet1!.B2?.v).toBe(1200)
    expect(book.Sheets.Sheet1!.B3?.f).toBe('SUM(B2:B2)')
    expect(book.Sheets.Sheet1!.AA4?.v).toBe('Far column')
    expect(book.Sheets.Notes!.A1?.v).toBe('Still typing')
    expect(source.getInput('Notes', 1, 1)).toBe('Before typing')
  })

  it('keeps the recovery copy when its engine snapshot cannot be decoded', async () => {
    const copy = keepRecovery('broken', JSON.stringify({ engine: 'not base64!' }))

    await expect(downloadRecovery('broken', 'Budget')).rejects.toThrow()
    expect(readRecovery('broken')).toEqual(copy)
  })

  it('hands the copy over once, then removes it', async () => {
    const saved: string[] = []
    // jsdom has no object URLs.
    const url = URL as {
      createObjectURL?: (blob: Blob) => string
      revokeObjectURL?: (href: string) => void
    }
    url.createObjectURL = () => 'blob:recovery'
    url.revokeObjectURL = () => {}
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download)
    })
    keepRecovery('node-1', workbook)

    await expect(downloadRecovery('node-1', 'Budget')).resolves.toBe(true)
    expect(saved).toEqual(['Budget (recovered).xlsx'])
    expect(readRecovery('node-1')).toBeNull()
    await expect(downloadRecovery('node-1', 'Budget')).resolves.toBe(false)
    click.mockRestore()
    delete url.createObjectURL
    delete url.revokeObjectURL
  })
})
