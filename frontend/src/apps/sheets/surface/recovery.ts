/**
 * Sheets' local recovery copy: the workbook kept on this device when unsaved
 * work cannot reach the server. It includes a cell edit still in progress. It
 * is never replayed automatically. The person takes it out as an Excel file.
 * It is removed once downloaded, or once the spreadsheet saves again with edit
 * access, because it is then stale.
 */
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

function isRecoveryRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function keepRecovery(node: string, workbook: string, now = new Date()): RecoveryCopy {
  const copy = { savedAt: now.toISOString(), workbook }
  localStorage.setItem(key(node), JSON.stringify(copy))
  return copy
}

export function readRecovery(node: string): RecoveryCopy | null {
  try {
    const copy: unknown = JSON.parse(localStorage.getItem(key(node)) ?? 'null')
    return isRecoveryRecord(copy) &&
      typeof copy.workbook === 'string' &&
      typeof copy.savedAt === 'string'
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

async function sheetsOf(workbook: string): Promise<Record<string, Cells>> {
  // Let decoding errors reach the caller so downloadRecovery keeps the local copy.
  const saved: unknown = JSON.parse(workbook)
  if (!isRecoveryRecord(saved)) throw new Error('Recovery workbook must be an object')
  if (typeof saved.engine === 'string') return engineSheets(saved.engine, saved.draft)
  const unpacked = unpackSheet(saved.sheet)
  if (unpacked == null) return {}
  if (!isRecoveryRecord(unpacked)) throw new Error('Recovery sheets must be an object')
  if (unpacked.sheets === undefined) return {}
  if (!isRecoveryRecord(unpacked.sheets)) throw new Error('Recovery sheets must be a map')
  const sheets: Record<string, Cells> = {}
  for (const [name, cells] of Object.entries(unpacked.sheets)) {
    if (!isRecoveryRecord(cells)) throw new Error('Recovery cells must be a map')
    sheets[name] = cells
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

/** The cells of a copy kept as engine bytes, with the cell edit that was still being typed. */
async function engineSheets(engine: string, draft: unknown): Promise<Record<string, Cells>> {
  const [{ default: init }, { createWorkbook }, { base64ToBytes }] = await Promise.all([
    import('@ironcalc/wasm'),
    import('@/apps/sheets/core/workbook'),
    import('@/apps/sheets/core/snapshot-codec'),
  ])
  await init()
  const book = createWorkbook({ loadBytes: base64ToBytes(engine) })
  const sheets: Record<string, Cells> = {}
  for (const name of book.getSheets()) {
    const cells: Cells = {}
    const used = book.usedCells(name)
    // `usedCells` answers flat 1-based (row, col) pairs.
    for (let i = 0; i < used.length; i += 2) {
      const row = used[i]!
      const col = used[i + 1]!
      cells[cellId(row - 1, col - 1)] = book.getInput(name, row, col)
    }
    sheets[name] = cells
  }
  if (
    !draft ||
    typeof draft !== 'object' ||
    !('sheet' in draft) ||
    !('cell' in draft) ||
    !('value' in draft)
  )
    return sheets
  const typed = draft
  if (
    typeof typed.sheet === 'string' &&
    typeof typed.cell === 'string' &&
    typeof typed.value === 'string'
  ) {
    ;(sheets[typed.sheet] ??= {})[typed.cell] = typed.value
  }
  return sheets
}
