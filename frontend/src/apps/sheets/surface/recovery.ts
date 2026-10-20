/**
 * Sheets' local recovery copy: the workbook kept on this device when unsaved
 * work cannot reach the server. It includes a cell edit still in progress. It
 * is never replayed automatically. The person takes it out as an Excel file.
 * It is removed once downloaded, or once the spreadsheet saves again with edit
 * access, because it is then stale.
 */
import { base64ToBytes } from '@/apps/sheets/core/snapshot-codec'
import { toXlsxCell } from '@/apps/sheets/engine/xlsx-io.js'
import { cellId, colLabel, parseCellId } from '@/apps/sheets/utils/cells.js'
import { unpackSheet } from '@/apps/sheets/utils/sheet-codec.js'

export interface RecoveryCopy {
  savedAt: string
  /** The workbook JSON, in the shape `sheets_data` stores. */
  workbook: string
}

type Cells = Record<string, unknown>

const key = (node: string) => `suite:sheets-recovery:${node}`

export function keepRecovery(node: string, workbook: string, now = new Date()): RecoveryCopy {
  const copy = { savedAt: now.toISOString(), workbook }
  localStorage.setItem(key(node), JSON.stringify(copy))
  return copy
}

export function readRecovery(node: string): RecoveryCopy | null {
  try {
    const copy = JSON.parse(
      localStorage.getItem(key(node)) ?? 'null',
    ) as Partial<RecoveryCopy> | null
    return typeof copy?.workbook === 'string' && typeof copy.savedAt === 'string'
      ? { savedAt: copy.savedAt, workbook: copy.workbook }
      : null
  } catch {
    return null
  }
}

export function clearRecovery(node: string): void {
  localStorage.removeItem(key(node))
}

/**
 * The copy as an `.xlsx` file, named after the spreadsheet title. It keeps
 * every sheet, value and formula. Formatting is not kept.
 */
export async function recoveryFile(copy: RecoveryCopy, title: string): Promise<File> {
  const { utils, write } = await import('xlsx')
  const book = utils.book_new()
  const used = new Set<string>()
  for (const [name, cells] of Object.entries(await sheetsOf(copy.workbook))) {
    utils.book_append_sheet(book, worksheet(cells), sheetName(name, used))
  }
  if (!book.SheetNames.length) utils.book_append_sheet(book, {}, 'Sheet1')
  const bytes: ArrayBuffer = write(book, { type: 'array', bookType: 'xlsx' })
  const name = title.replace(/[<>:"/\\|?*]/g, '').trim() || 'Spreadsheet'
  return new File([bytes], `${name} (recovered).xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Save the spreadsheet's recovery copy through the browser, then remove it. False when none is kept. */
export async function downloadRecovery(node: string, title: string): Promise<boolean> {
  const copy = readRecovery(node)
  if (!copy) return false
  const file = await recoveryFile(copy, title)
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  clearRecovery(node)
  return true
}

interface SavedWorkbook {
  /** IronCalc's bytes, base64. */
  engine?: unknown
  /** A develop sheet's packed rows. */
  sheet?: unknown
  /** A cell edit still in progress. */
  draft?: { sheet?: unknown; cell?: unknown; value?: unknown } | null
}

async function sheetsOf(workbook: string): Promise<Record<string, Cells>> {
  let saved: SavedWorkbook
  try {
    saved = JSON.parse(workbook) as SavedWorkbook
  } catch {
    return {}
  }
  const sheets =
    typeof saved.engine === 'string'
      ? await engineSheets(base64ToBytes(saved.engine))
      : packedSheets(saved.sheet)
  const draft = saved.draft
  if (typeof draft?.sheet === 'string' && typeof draft.cell === 'string') {
    ;(sheets[draft.sheet] ??= {})[draft.cell] = draft.value
  }
  return sheets
}

function packedSheets(packed: unknown): Record<string, Cells> {
  try {
    const unpacked = unpackSheet(packed) as { sheets?: Record<string, Cells> } | null | undefined
    return unpacked?.sheets ?? {}
  } catch {
    return {}
  }
}

/** Every cell's input, read from IronCalc's bytes on this thread. */
async function engineSheets(bytes: Uint8Array): Promise<Record<string, Cells>> {
  const { default: init } = await import('@ironcalc/wasm')
  await init()
  const { createWorkbook } = await import('@/apps/sheets/core/workbook')
  const book = createWorkbook({ loadBytes: bytes })
  const sheets: Record<string, Cells> = {}
  for (const name of book.getSheets()) {
    const cells: Cells = (sheets[name] = {})
    const used = book.usedCells(name)
    for (let i = 0; i < used.length; i += 2) {
      const row = used[i]!
      const col = used[i + 1]!
      cells[cellId(row - 1, col - 1)] = book.getInput(name, row, col)
    }
  }
  return sheets
}

/** One sheet's cells as a SheetJS worksheet. A formula has no cached value: the opening app computes it. */
function worksheet(cells: Cells) {
  const sheet: Record<string, unknown> = {}
  let lastRow = -1
  let lastCol = 0
  for (const [id, raw] of Object.entries(cells)) {
    const at = parseCellId(id)
    const cell = at && toXlsxCell(raw, null, '')
    if (!at || !cell) continue
    sheet[id] = cell
    lastRow = Math.max(lastRow, at.row)
    lastCol = Math.max(lastCol, at.col)
  }
  if (lastRow >= 0) sheet['!ref'] = `A1:${colLabel(lastCol)}${lastRow + 1}`
  return sheet
}

/** Excel limits a sheet name to 31 characters, bans `[]:*?/\` and duplicates. */
function sheetName(name: string, used: Set<string>): string {
  const base =
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .slice(0, 31)
      .trim() || 'Sheet'
  let candidate = base
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
    const suffix = ` (${n})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}
