import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { utils, write } from 'xlsx'

import { createHistory } from '../../engine/history'
import { useExportImport } from './useExportImport.js'

type Workbook = Map<string, Record<string, string>>

/** An editor's workbook, its undo history and its import, wired as the editor wires them. */
function openWorkbook() {
  let workbook: Workbook = new Map([['Sheet1', {}]])
  const currentSheet = ref('Sheet1')
  const history = createHistory<Workbook>({
    snapshot: () => structuredClone(workbook),
    restore: (snap) => {
      workbook = structuredClone(snap)
    },
  })
  history.init()
  const io = useExportImport({
    cells: {
      readSheet: async () => ({ inputs: [], displays: [] }),
      write: (sheet: string, map: Record<string, string>) =>
        Object.assign(workbook.get(sheet)!, map),
      clear: async (sheet: string) => workbook.set(sheet, {}),
      addSheet: (name: string) => workbook.set(name, {}),
      idle: async () => {},
    },
    sheetNames: () => [...workbook.keys()],
    currentSheet,
    getCurrentTitle: () => 'Budget',
    repopulateGrid: () => {},
    switchSheet: (name: string) => {
      currentSheet.value = name
    },
    syncFlags: () => {},
    recordUndoStep: () => history.push(),
    isDirty: ref(false),
  })
  return {
    history,
    sheets: () => [...workbook.keys()],
    deleteSheet(name: string) {
      workbook.delete(name)
      history.push()
    },
    async importXlsx(sheets: Record<string, string[][]>) {
      const book = utils.book_new()
      for (const [name, rows] of Object.entries(sheets))
        utils.book_append_sheet(book, utils.aoa_to_sheet(rows), name)
      const bytes = write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
      const target = { files: [{ arrayBuffer: async () => bytes }], value: 'q4.xlsx' }
      await io.importXLSX({ target })
    },
  }
}

describe('Sheets: importing a file', () => {
  it('undoes an import as one step, after the step that followed it', async () => {
    const editor = openWorkbook()
    await editor.importXlsx({ 'Q4 Budget': [['Item', 'Cost']], Headcount: [['Team']] })
    expect(editor.history.canUndo()).toBe(true)

    editor.deleteSheet('Sheet1')
    editor.history.undo()
    expect(editor.sheets()).toEqual(['Sheet1', 'Q4 Budget', 'Headcount'])

    editor.history.undo()
    expect(editor.sheets()).toEqual(['Sheet1'])
  })
})
