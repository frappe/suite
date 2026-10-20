import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { read } from 'xlsx'

import { bytesToBase64 } from '../core/snapshot-codec'
import { createWorkbook } from '../core/workbook'
import { downloadRecovery, keepRecovery, readRecovery, recoveryFile } from './recovery'

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

  it('reads the cells of a workbook saved as IronCalc bytes, with the edit still in progress', async () => {
    initSync({
      module: fs.readFileSync(
        createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm'),
      ),
    })
    const book = createWorkbook()
    const sheet = book.getSheets()[0]!
    book.apply({
      id: '1',
      actor: 'local',
      ts: 0,
      type: 'batch',
      payload: {
        commands: [
          {
            id: '2',
            actor: 'local',
            ts: 0,
            type: 'setInput',
            payload: { sheet, row: 1, col: 1, input: 'Rent' },
          },
          {
            id: '3',
            actor: 'local',
            ts: 0,
            type: 'setInput',
            payload: { sheet, row: 1, col: 2, input: '=2*600' },
          },
        ],
      },
    })
    const saved = JSON.stringify({
      engine: bytesToBase64(book.toBytes()),
      draft: { sheet, cell: 'A2', value: 'typing' },
    })

    const file = await recoveryFile(
      { savedAt: '2026-10-20T10:00:00.000Z', workbook: saved },
      'Budget',
    )

    const recovered = read(await file.arrayBuffer()).Sheets[sheet]!
    expect(recovered.A1?.v).toBe('Rent')
    expect(recovered.B1?.f).toBe('2*600')
    expect(recovered.A2?.v).toBe('typing')
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
