import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createNamedRanges } from '../../engine/named-ranges.js'
import { useWorkbook } from './useWorkbook.js'

interface Sent {
  type: string
  payload: { name?: string; formula?: string; commands?: Sent[] }
}

// A workbook client that records what it is sent; setSheets plays IronCalc
// reporting its sheet list after an apply or a restore.
const client = vi.hoisted(() => ({
  sheets: [] as string[],
  sent: [] as unknown[],
  sheetsCb: null as null | (() => void),
}))
vi.mock('../../core/client', () => ({
  createWorkbookClient: async () => ({
    get sheets() {
      return client.sheets
    },
    dispatch: (c: unknown) => client.sent.push(c),
    onCommandError: () => {},
    onSheets: (cb: () => void) => {
      client.sheetsCb = cb
      return () => {}
    },
    onVersion: () => () => {},
    onCrash: () => () => {},
    usedCells: () => new Promise(() => {}),
    terminate: () => {},
  }),
}))
vi.mock('../../core/cell-provider', () => ({ createCellProvider: () => ({ dispose() {} }) }))

const setSheets = (sheets: string[]) => {
  client.sheets = sheets
  client.sheetsCb?.()
}

// The name commands sent since the last call, batches flattened.
const namesSent = () => {
  const out: string[] = []
  const walk = (c: Sent) => {
    if (c.type === 'batch') c.payload.commands?.forEach(walk)
    else out.push(`${c.type} ${c.payload.name}${c.payload.formula ? ` ${c.payload.formula}` : ''}`)
  }
  ;(client.sent.splice(0) as Sent[]).forEach(walk)
  return out
}

// ISSUES #77: IronCalc refuses to create a name on a sheet it doesn't have,
// and fails the whole batch with it.
describe('syncDefinedNames and the sheet list', () => {
  async function start() {
    client.sheets = ['Sheet1', 'Data']
    client.sent = []
    const namedRanges = createNamedRanges()
    namedRanges.add({ name: 'rng', sheet: 'Sheet1', range: 'A1:A3' })
    namedRanges.add({ name: 'far', sheet: 'data', range: 'A1' })
    // The tab list: what IronCalc has once everything sent so far applies.
    const tabs = ref<string[]>([])
    const wb = useWorkbook({
      currentSheet: ref('Sheet1'),
      namedRanges: () => namedRanges,
      getGrid: () => null,
      sheetNames: () => tabs.value,
      syncNames: () => (tabs.value = client.sheets),
      onVersion: () => {},
      onUsedExtent: () => {},
      onCrash: () => {},
    })
    await wb.startEngine()
    return { wb, namedRanges, tabs }
  }

  it('sends every name whose sheet exists on start, matching it case-insensitively', async () => {
    await start()
    expect(namesSent()).toEqual([
      "setDefinedName rng 'Sheet1'!$A$1:$A$3",
      "setDefinedName far 'data'!$A$1",
    ])
  })

  it('never sends a name on a sheet the tab list lacks', async () => {
    const { wb, namedRanges, tabs } = await start()
    namesSent()
    // A tab deleted (the tab list updates at once, IronCalc reports later).
    tabs.value = ['Sheet1']
    namedRanges.update('rng', { range: 'A1:A2' })
    wb.syncDefinedNames()
    expect(namesSent()).toEqual(["setDefinedName rng 'Sheet1'!$A$1:$A$2", 'deleteDefinedName far'])
    // A new name on a missing sheet, e.g. one a file was saved with.
    namedRanges.add({ name: 'ghost', sheet: 'Gone', range: 'B2' })
    wb.syncDefinedNames()
    expect(namesSent()).toEqual(['deleteDefinedName ghost'])
  })

  // Undo restores IronCalc's bytes; the tab list only follows when IronCalc
  // reports the restored sheets, after the undo's own sync.
  it('re-syncs when IronCalc reports a new sheet list', async () => {
    const { wb, tabs } = await start()
    tabs.value = ['Sheet1']
    wb.syncDefinedNames()
    namesSent()
    setSheets(['Sheet1', 'Data'])
    expect(tabs.value).toEqual(['Sheet1', 'Data'])
    expect(namesSent()).toEqual(["setDefinedName far 'data'!$A$1"])
  })
})
