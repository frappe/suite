import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { createPivotEngine } from '../../engine/pivot.js'
import { usePivotIntegration } from './usePivotIntegration.js'

// ISSUES #153: a pivot without a header row names its fields by column, so a
// copy that lost `hasHeader` read row 1 as names and came out empty.
describe('copying a pivot', () => {
  it('keeps whether its source has a header row', () => {
    const pivot = createPivotEngine()
    pivot.add({
      sourceSheet: 'Sheet1',
      sourceRange: 'A1:B5',
      hasHeader: false,
      rows: ['Column B'],
      values: [{ field: 'Column A', agg: 'sum' }],
      outputSheet: 'Sheet1',
      anchorRow: 0,
      anchorCol: 3,
    })
    const id = pivot.list()[0]!.id
    pivot.setExtent(id, { r0: 0, c0: 3, r1: 6, c1: 4 })
    const ui = usePivotIntegration({
      pivot,
      cells: {},
      sheetNames: ref(['Sheet1']),
      formats: {},
      currentSheet: ref('Sheet1'),
      activeCell: ref('A1'),
      renderVersion: ref(0),
      getGrid: () => null,
      contextMenu: { open: false },
      switchSheet: () => {},
      syncNames: () => {},
      history: { push: () => {} },
      isDirty: ref(false),
      repopulateGrid: () => {},
    })
    expect(ui.getPivotAt({ r0: 1, c0: 3, r1: 1, c1: 3 }, 'Sheet1')).toMatchObject({
      hasHeader: false,
      rows: ['Column B'],
    })
  })
})
