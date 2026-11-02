import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createSortFilter } from '../../engine/sortFilter'
import type { Rect } from '../../engine/types'
import { cellId } from '../../utils/cells'
import { useSortFilter } from './useSortFilter.js'

const BUDGET: Record<string, string> = {
  C5: 'Item',
  D5: 'Cost',
  C6: 'Rent',
  D6: '900',
  C7: 'Food',
  D7: '120',
  C8: 'Total',
  D8: '=SUM(D6:D7)',
}

function sheet(selection: Rect, activeCell: string) {
  const cells: Record<string, string> = { ...BUDGET }
  const read = async (_sheet: string, rect: Rect) => {
    const rows: string[][] = []
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row: string[] = []
      for (let c = rect.c0; c <= rect.c1; c++) row.push(cells[cellId(r, c)] ?? '')
      rows.push(row)
    }
    return { inputs: rows, displays: rows }
  }
  const write = (_sheet: string, changed: Record<string, string>) => Object.assign(cells, changed)
  const sortDialog = { open: vi.fn() }
  const pushEditOp = vi.fn()
  const sorting = useSortFilter({
    sortFilter: createSortFilter({ read, write } as never),
    currentSheet: ref('Sheet1'),
    activeCell: ref(activeCell),
    renderVersion: ref(0),
    gridWrapRef: ref(null),
    getGrid: () => ({ getSelection: () => selection }),
    readRect: read,
    rectBlocked: () => false,
    pushEditOp,
    sheetExtent: async () => ({ maxRow: 7, maxCol: 3 }),
    sortDialog: () => sortDialog,
  } as never)
  return { cells, sorting, sortDialog, pushEditOp }
}

const ONE_CELL = { r0: 0, c0: 0, r1: 0, c1: 0 }

describe('sorting from a menu', () => {
  it('finds the data down a column that does not start at row 1', async () => {
    const { cells, sorting } = sheet(ONE_CELL, 'A1')

    await sorting.sortRange('asc', 3)

    expect(cells).toMatchObject({ C5: 'Item', C6: 'Food', D6: '120', C7: 'Rent', C8: 'Total' })
  })

  it('does nothing from the header of an empty column', async () => {
    const { sorting, pushEditOp } = sheet(ONE_CELL, 'A1')

    await sorting.sortRange('asc', 0)

    expect(pushEditOp).not.toHaveBeenCalled()
  })

  it('opens the dialog with the same range and its guesses', async () => {
    const { sorting, sortDialog } = sheet({ r0: 6, c0: 3, r1: 6, c1: 3 }, 'D7')

    await sorting.openSortDialog()

    expect(sortDialog.open).toHaveBeenCalledWith({
      rect: { r0: 4, c0: 2, r1: 7, c1: 3 },
      col: 3,
      header: true,
      totals: true,
    })
  })

  it('takes the dialog at its word when a guess is unticked', async () => {
    const { cells, sorting } = sheet(ONE_CELL, 'A1')

    await sorting.applySort({
      rect: { r0: 4, c0: 2, r1: 7, c1: 3 },
      col: 2,
      dir: 'asc',
      header: false,
      totals: false,
    })

    expect(cells).toMatchObject({ C5: 'Food', C6: 'Item', C7: 'Rent', C8: 'Total' })
  })
})
