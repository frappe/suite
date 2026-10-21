import { describe, expect, it, vi } from 'vitest'

import { createFormatsEngine } from '../../engine/formats.js'
import { useHistory } from './useHistory.js'

// Undo and redo put each cell's saved format back. formats.set merges, so a
// format added by the step (bold) survived its undo, and sort moving formats
// with their rows left the old row's bold behind (ISSUES #48).
describe('useHistory format maps', () => {
  function setup() {
    const formats = createFormatsEngine()
    const { history, undo, redo } = useHistory({
      currentSheet: { value: 'Sheet1' },
      engines: { formats },
      getGrid: () => null,
      engineClient: () => null,
      command: vi.fn(),
      writeInputs: vi.fn(),
      syncDefinedNames: vi.fn(),
      addSheet: vi.fn(),
      deleteSheet: vi.fn(),
      getLocalTouches: () => null,
      syncFlags: vi.fn(),
      markDirty: vi.fn(),
      afterStructural: vi.fn(),
      afterNavigate: vi.fn(),
    })
    return { formats, history, undo, redo }
  }

  it('replaces the format instead of merging into it', () => {
    const t = setup()
    t.formats.set('A1', { italic: true, bold: true }, 'Sheet1')
    // Undo never steps past the first entry (the loaded state).
    t.history.pushOp({ opType: 'edit', subSheet: 'Sheet1', before: {}, after: {} })
    t.history.pushOp({
      opType: 'format',
      subSheet: 'Sheet1',
      before: {},
      after: {},
      beforeFormats: { A1: { italic: true } },
      afterFormats: { A1: { italic: true, bold: true } },
    })
    t.undo()
    expect(t.formats.getCellFormat('A1', 'Sheet1')).toEqual({ italic: true })
    t.redo()
    expect(t.formats.getCellFormat('A1', 'Sheet1')).toEqual({ italic: true, bold: true })
  })
})
