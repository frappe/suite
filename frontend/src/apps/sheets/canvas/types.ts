// The grid's contract with its host (SheetEditor): what createGrid is given
// (GridOptions) and what it hands back (Grid).
//
// Cell ids are A1-style; rows and columns are 0-based. Rects returned to the
// host are canvas-local CSS pixels with zoom already applied.

import type { CellBlock, DropdownPos, LinkHover, ValidationRule } from './input/mouse.js'
import type { SelMode, SelRange } from './selection.js'

/** A cell's value as the grid holds or displays it. */
export type CellValue = string | number | boolean | null | undefined

/** The format fields the canvas itself reads; painters read more. */
export interface CellFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontSize?: number
  fontFamily?: string
  align?: string
  color?: string
  backgroundColor?: string
  bg?: string
  textWrap?: string
  wrapText?: boolean
  hyperlink?: string
}

export interface MergeInfo {
  rowSpan: number
  colSpan: number
}

/** Callbacks and data sources from the host. All optional. */
export interface GridOptions {
  // Edits and selection
  onSelect?(label: string): void
  onInput?(id: string, value: string): void
  onCommit?(id: string, value: string): void
  onCancel?(id: string): void
  onBatchCommit?(cells: { id: string; value: string }[]): void
  onFill?(src: CellBlock, total: SelRange, opts: { withModifier: boolean }): void
  onBlockedEdit?(): void
  canEdit?(): boolean
  isCellEditable?(r: number, c: number): boolean

  // Values
  /** Lazy mode: the display text for a cell, read on demand. */
  getDisplay?(id: string): CellValue
  /** Lazy mode: every non-empty cell id on the current sheet. */
  getCellIds?(): string[]
  /** What the editor opens with (a formula's text, not its result). */
  getEditValue?(id: string): CellValue
  lazyValues?: boolean

  // Cell decoration, read by the painters
  getFormat?(id: string): CellFormat | null | undefined
  getMergeInfo?(id: string): MergeInfo | null | undefined
  isSlave?(id: string): boolean
  getMasterId?(id: string): string | null | undefined
  getValidation?(id: string): ValidationRule | null | undefined
  // Passed through to the painters; the grid doesn't look inside.
  getComment?(id: string): unknown
  getCondFormat?(id: string): unknown
  getSparkline?(id: string): unknown
  getRightInset?(id: string): number

  // Pointer actions
  onHyperlinkClick?(url: string): void
  onLinkHover?(info: LinkHover | null): void
  onDropdownClick?(id: string, rule: ValidationRule, pos: DropdownPos): void
  onCheckboxToggle?(id: string): void
  onPivotDrill?(r: number, c: number): boolean | undefined
  onResizeEnd?(): void
  onColMove?(fromCol: number, toCol: number, count: number): void

  // Cross-sheet formula picking
  getSheetNames?(): string[]
  getCurrentSheet?(): string
  /** The sheet the formula being edited lives on. */
  getEditingHomeSheet?(): string | null | undefined
}

/** Widths, heights, freeze, hides, size and zoom: saved with the sheet. */
export interface ViewSnapshot {
  colW: { [col: number]: number }
  rowH: { [row: number]: number }
  freezeRows: number
  freezeCols: number
  hiddenRows: number[]
  hiddenCols: number[]
  totalRows: number
  totalCols: number
  zoom: number
}

export interface PxRect {
  x: number
  y: number
  width: number
  height: number
}

/** Maps an old row/column index to its new one; null/negative drops it. */
export type IndexMap = (i: number) => number | null | undefined

export interface Grid {
  resize(w: number, h: number): void
  render(): void
  /** Eager mode: update the grid's value cache. Lazy mode: just repaint. */
  setCell(id: string, value: CellValue): void
  batchSetCells(map: { [id: string]: CellValue }): void
  clearAll(): void
  getCell(id: string): CellValue
  getActiveCell(): string
  /** The in-cell editor is open on a `=…` formula (kept open across sheet tabs). */
  isEditingFormula(): boolean
  isEditing(): boolean
  getSelection(): SelRange
  setSelection(range?: Partial<SelRange>): void
  /** The selection before the last press (the context menu restores it). */
  getPreMousedownSel(): SelRange | null
  moveTo(r: number, c: number): void

  getColWidth(c: number): number
  setColWidth(c: number, w: number): void
  getRowHeight(r: number): number
  setRowHeight(r: number, h: number): void
  shiftRowHeights(atRow: number, delta: number): void
  shiftColWidths(atCol: number, delta: number): void
  remapColsMeta(mapCol: IndexMap): void
  remapRowsMeta(mapRow: IndexMap): void
  getHitRegion(
    ex: number,
    ey: number,
  ): { headerCol: number | null; headerRow: number | null; cell: { r: number; c: number } | null }

  setFreeze(rows: number, cols: number): void
  setHiddenRows(rows: Iterable<number>): void
  setHiddenCols(cols: Iterable<number>): void
  setFilterHiddenRows(rows: Iterable<number>): void
  getHiddenRows(): Set<number>
  getHiddenCols(): Set<number>

  getColumnHeaderRects(): { c: number; x: number; width: number }[]
  getRow0Rect(): { y: number; height: number }
  getRowRect(r: number): { y: number; height: number }
  getCellRect(r: number, c: number): PxRect
  getViewportSize(): { w: number; h: number }
  onRender(cb: () => void): () => void

  setMarchingAnts(rect: Partial<CellBlock> | null | undefined): void
  setDiffOverlay(diffBySheet: { [sheet: string]: { [id: string]: boolean } } | null): void
  setActiveDiffSheet(sheet: string | null): void

  autoFitCol(c: number): void
  autoFitRow(r: number): void
  /** Grow a row to fit a committed multi-line value; the height change, or null. */
  autoGrowRowFor(r: number, c: number, value: CellValue): { before: number; after: number } | null

  expandRows(by?: number): void
  expandCols(by?: number): void
  getTotalRows(): number
  getTotalCols(): number
  isNearBottom(threshold?: number): boolean
  setZoom(z: number): void
  getZoom(): number

  viewSnapshot(): ViewSnapshot
  viewRestore(snap: Partial<ViewSnapshot> | null | undefined): void
  setLazyValues(on: boolean): void
  isLazyValues(): boolean
  destroy(): void
}

export type { SelMode, SelRange }
