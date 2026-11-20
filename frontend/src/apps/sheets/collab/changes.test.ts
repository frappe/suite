import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { changedCellMap, changedCells } from './changes'
import { addSheet, axis, cellKey, initDoc, roots } from './schema'

/** A doc with one sheet holding `cells` ("row,col" → input), and its copy to edit as "now". */
function versionAndNow(cells: Record<string, string>) {
  const version = new Y.Doc()
  initDoc(version)
  const sheetId = addSheet(version, 'Sheet1')
  version.transact(() => {
    for (const [at, input] of Object.entries(cells)) {
      const [row, col] = fromPartial<[number, number]>(at.split(',').map(Number))
      const key = cellKey(
        sheetId,
        axis(version, sheetId, 'rows').ensure(row),
        axis(version, sheetId, 'cols').ensure(col),
      )
      roots(version).inputs.set(key, input)
    }
  })
  const now = new Y.Doc()
  Y.applyUpdate(now, Y.encodeStateAsUpdate(version))
  return { version, now, sheetId }
}

function keyAt(doc: Y.Doc, sheetId: string, row: number, col: number) {
  return cellKey(
    sheetId,
    axis(doc, sheetId, 'rows').ensure(row),
    axis(doc, sheetId, 'cols').ensure(col),
  )
}

describe('changedCells', () => {
  it('lists nothing when the sheet is still the version', () => {
    const { version, now } = versionAndNow({ '0,0': '1', '2,1': '=A1*2' })
    expect(changedCells(version, now)).toEqual([])
  })

  it('lists edited, typed, cleared and reformatted cells by where the version shows them, top to bottom', () => {
    const { version, now, sheetId } = versionAndNow({ '0,0': '1', '1,0': '2', '4,3': 'x' })
    now.transact(() => {
      const inputs = roots(now).inputs
      inputs.set(keyAt(now, sheetId, 0, 0), '10') // A1 edited
      inputs.delete(keyAt(now, sheetId, 1, 0)) // A2 cleared
      inputs.set(keyAt(now, sheetId, 2, 2), 'new') // C3 typed since
      roots(now).formats.set(keyAt(now, sheetId, 4, 3), { bold: true }) // D5 made bold
    })
    expect(changedCells(version, now)).toEqual([
      { sheet: 'Sheet1', cell: 'A1' },
      { sheet: 'Sheet1', cell: 'A2' },
      { sheet: 'Sheet1', cell: 'C3' },
      { sheet: 'Sheet1', cell: 'D5' },
    ])
  })

  it('does not count cells a row inserted since then only moved', () => {
    const { version, now, sheetId } = versionAndNow({ '0,0': 'a', '3,0': 'b' })
    now.transact(() => axis(now, sheetId, 'rows').insert(1, 2))
    expect(changedCells(version, now)).toEqual([])
  })

  it('leaves out a cell on a sheet the version does not have, and orders cells by tab', () => {
    const { version, now, sheetId } = versionAndNow({ '0,0': '1' })
    const second = addSheet(version, 'Totals')
    version.transact(() => roots(version).inputs.set(keyAt(version, second, 0, 1), '=SUM(1)'))
    Y.applyUpdate(now, Y.encodeStateAsUpdate(version))
    now.transact(() => {
      roots(now).inputs.set(keyAt(now, sheetId, 5, 0), 'later')
      roots(now).inputs.set(keyAt(now, second, 0, 1), '=SUM(2)')
      const added = addSheet(now, 'Added since')
      roots(now).inputs.set(keyAt(now, added, 0, 0), 'gone in the version')
    })
    const cells = changedCells(version, now)
    expect(cells).toEqual([{ sheet: 'Totals', cell: 'B1' }])
    expect(changedCellMap(cells)).toEqual({ Totals: { B1: true } })
  })
})
