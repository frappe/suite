import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { describe, expect, it } from 'vitest'

import { createWorkbookClient, type WorkbookClient } from '../core/client'
import { createWorkerHost } from '../core/worker'
import {
  applyLegacyPlan,
  ironcalcSheetNames,
  planLegacySheet,
  unknownFunctionCells,
} from './legacy-sheet'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

// A Worker stand-in running the real IronCalc host (as in core/client.test.js).
function fakePort() {
  const host = createWorkerHost()
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage(message: unknown) {
      setTimeout(() => port.onmessage?.({ data: host.handle(structuredClone(message)) }), 0)
    },
  }
  return port
}

// What develop saved in sheets_data.sheet: the packed v2 shape from
// utils/sheet-codec.ts (row index → values by column, 0-based).
const DEVELOP_BODY = {
  v: 2,
  current: 'Costs',
  sheets: {
    Budget: {
      rows: {
        '0': ['Item', 'Amount'],
        '1': ['Rent', '1200'],
        '2': ['Food', '350.5'],
        '3': ['Total', '=SUM(B2:B3)'],
        '5': [null, '=sum(b2:b3)*2', '=FANCYTOTAL(B2:B3)'],
      },
    },
    Costs: {
      rows: {
        '0': ['=Budget!B4', '=SPARKLINE(Budget!B2:B3)', 'TRUE', '12%'],
      },
    },
  },
}

async function convert(body: unknown): Promise<{ client: WorkbookClient; ok: boolean }> {
  const client = await createWorkbookClient({ port: fakePort() })
  const plan = planLegacySheet(body)
  if (!plan) throw new Error('nothing to convert')
  const { ok } = await applyLegacyPlan(client, plan)
  return { client, ok }
}

async function shown(client: WorkbookClient, sheet: string, cells: string[]): Promise<string[]> {
  const res = await client.readCells({
    sheet,
    cells: cells.map((id) => ({
      row: Number(id.slice(1)),
      col: id.charCodeAt(0) - 64,
    })),
    what: ['display', 'input'],
  })
  return res.cells.map((c) => c.display ?? '')
}

describe('legacy sheet: the develop editor body → IronCalc', () => {
  it('keeps the sheets in tab order and remembers the open tab', async () => {
    const { client, ok } = await convert(DEVELOP_BODY)
    expect(ok).toBe(true)
    expect(client.sheets).toEqual(['Budget', 'Costs'])
    expect(planLegacySheet(DEVELOP_BODY)?.current).toBe('Costs')
  })

  it('types every cell in as the user wrote it, then recalculates once', async () => {
    const { client } = await convert(DEVELOP_BODY)
    expect(await shown(client, 'Budget', ['A1', 'B2', 'B4', 'B6'])).toEqual([
      'Item',
      '1200',
      '1550.5',
      '3101',
    ])
    // A formula reading another sheet sees that sheet's converted value.
    expect(await shown(client, 'Costs', ['A1', 'C1', 'D1'])).toEqual(['1550.5', 'TRUE', '12%'])
    const inputs = await client.readCells({
      sheet: 'Budget',
      cells: [{ row: 4, col: 2 }],
      what: ['input'],
    })
    expect(inputs.cells[0]?.input).toBe('=SUM(B2:B3)')
  })

  it('sends the whole conversion as one batch', () => {
    const plan = planLegacySheet(DEVELOP_BODY)
    expect(plan?.commands.length).toBe(1)
    expect(plan?.commands[0]?.type).toBe('batch')
  })

  it('lists the formulas IronCalc does not know, but not sparklines', async () => {
    const { client } = await convert(DEVELOP_BODY)
    const plan = planLegacySheet(DEVELOP_BODY)
    expect(await unknownFunctionCells(client, plan?.formulas ?? [])).toEqual([
      { sheet: 'Budget', cell: 'C6', formula: '=FANCYTOTAL(B2:B3)' },
    ])
  })

  it('reads the old unpacked shape (no version) too', async () => {
    const { client } = await convert({
      sheets: { Sheet1: { A1: '2', A2: '=A1*3' } },
      current: 'Sheet1',
    })
    expect(client.sheets).toEqual(['Sheet1'])
    expect(await shown(client, 'Sheet1', ['A2'])).toEqual(['6'])
  })

  it('keeps numbers and booleans an import stored as non-strings', async () => {
    const { client } = await convert({ v: 2, sheets: { Sheet1: { rows: { '0': [42, false] } } } })
    expect(await shown(client, 'Sheet1', ['A1', 'B1'])).toEqual(['42', 'FALSE'])
  })

  it('renames sheets whose names IronCalc refuses, and their references', async () => {
    const body = {
      v: 2,
      current: 'Q1/Q2',
      sheets: {
        'Q1/Q2': { rows: { '0': ['5'] } },
        q1_q2: { rows: { '0': ['7'] } },
        Report: { rows: { '0': ["='Q1/Q2'!A1+q1_q2!A1"] } },
      },
    }
    const plan = planLegacySheet(body)
    expect(plan?.renamed).toEqual({ 'Q1/Q2': 'Q1_Q2 (2)' })
    expect(plan?.current).toBe('Q1_Q2 (2)')
    const { client, ok } = await convert(body)
    expect(ok).toBe(true)
    expect(client.sheets).toEqual(['Q1_Q2 (2)', 'q1_q2', 'Report'])
    expect(await shown(client, 'Report', ['A1'])).toEqual(['12'])
  })

  it('gives each refused name a valid, unique replacement', () => {
    const names = ironcalcSheetNames([
      'Sales: 2026',
      'Data [old]',
      'x?',
      'a'.repeat(40),
      'Sheet1',
      'sheet1',
      '',
    ])
    expect(names).toEqual({
      'Sales: 2026': 'Sales_ 2026',
      'Data [old]': 'Data _old_',
      'x?': 'x_',
      ['a'.repeat(40)]: 'a'.repeat(31),
      sheet1: 'sheet1 (2)',
      '': 'Sheet',
    })
  })

  it('opens a first sheet that only differs from Sheet1 by case', async () => {
    const { client, ok } = await convert({ v: 2, sheets: { sheet1: { rows: { '0': ['x'] } } } })
    expect(ok).toBe(true)
    expect(client.sheets).toEqual(['sheet1'])
  })

  it('drops cells beyond the last row IronCalc has, and counts them', async () => {
    const body = { sheets: { Sheet1: { A1: 'kept', A1048577: 'too far' } } }
    expect(planLegacySheet(body)?.skipped).toBe(1)
    const { client, ok } = await convert(body)
    expect(ok).toBe(true)
    expect(await shown(client, 'Sheet1', ['A1'])).toEqual(['kept'])
  })

  it('reports a conversion IronCalc refused, leaving the workbook empty', async () => {
    const client = await createWorkbookClient({ port: fakePort() })
    const plan = planLegacySheet({ sheets: { Sheet1: { A1: 'x' } } })
    if (!plan) throw new Error('no plan')
    // A command IronCalc refuses inside the batch rolls the whole batch back.
    const batch = plan.commands[0]
    if (batch?.type !== 'batch') throw new Error('no batch')
    batch.payload.commands.push({
      id: 'bad',
      actor: 'local',
      ts: 0,
      type: 'renameSheet',
      payload: { sheet: 'Sheet1', name: 'a/b' },
    })
    expect(await applyLegacyPlan(client, plan)).toMatchObject({ ok: false })
    expect(await shown(client, 'Sheet1', ['A1'])).toEqual([''])
  })

  it('has nothing to convert without a sheets map', () => {
    expect(planLegacySheet(undefined)).toBeNull()
    expect(planLegacySheet('nonsense')).toBeNull()
    expect(planLegacySheet({ v: 2 })).toBeNull()
  })
})
