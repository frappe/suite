// The grid's contract with its host (SheetEditor).
//
// Two ports go in (spec §2): a CellProvider the grid reads cells through, and
// a GridHost it reports to. The Grid object comes back. Cell ids are A1-style;
// rows and columns are 0-based. Rects handed to the host are canvas-local CSS
// pixels with zoom already applied.

import type { Cell, IndexMap, SelMode, ViewSnapshot } from '../core/view-model.js'
import type { SparkSpec } from '../engine/sparkline.js'
import type { ValidationRule } from '../engine/validation.js'
import type { SelRange } from './selection.js'

/** A cell's value as the grid holds or displays it. */
export type CellValue = string | number | boolean | null | undefined

export interface BorderSpec {
  style?: 'thin' | 'medium' | 'thick' | string
  color?: string
}

/** The format fields the canvas reads. */
export interface CellFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontSize?: number
  fontFamily?: string
  align?: string
  valign?: string
  color?: string
  backgroundColor?: string
  bg?: string
  textWrap?: string
  wrapText?: boolean
  hyperlink?: string
  borderTop?: BorderSpec
  borderBottom?: BorderSpec
  borderLeft?: BorderSpec
  borderRight?: BorderSpec
}

export interface DataBar {
  /** 0..1 */
  value?: number
  negative?: boolean
  negativeColor?: string
  color?: string
}

export interface CondIcon {
  shape: string
  color?: string
}

/** A conditional-format result: format overrides plus bar/icon decorations. */
export interface CondFormat extends CellFormat {
  dataBar?: DataBar
  icon?: CondIcon
}

export interface MergeInfo {
  rowSpan: number
  colSpan: number
}

/** A block of cells, corners inclusive. */
export interface CellBlock {
  r0: number
  c0: number
  r1: number
  c1: number
}

/** Where a list dropdown opens, in page pixels. */
export interface DropdownPos {
  x: number
  y: number
  w: number
}

export interface LinkHover {
  r: number
  c: number
  id: string
  url: string
}

/** Reads: everything the grid asks about cells. All optional. */
export interface CellProvider {
  /** Lazy mode: a cell's display text, read per visible cell. */
  getDisplay?(id: string): CellValue
  /** What the editor opens with (a formula's text, not its result). */
  getEditValue?(id: string): CellValue
  /** Every non-empty cell id on the sheet (Ctrl+A, Ctrl+End, autofit). */
  getCellIds?(): string[]
  getStyle?(id: string): CellFormat | null | undefined
  getMergeInfo?(id: string): MergeInfo | null | undefined
  isSlave?(id: string): boolean
  getMasterId?(id: string): string | null | undefined
  /** True when the cell has an open comment (draws the corner mark). */
  getComment?(id: string): boolean | null | undefined
  getValidation?(id: string): ValidationRule | null | undefined
  getCondFormat?(id: string, value: CellValue): CondFormat | null | undefined
  getSparkline?(id: string): SparkSpec | null | undefined
  /** Px reserved on a cell's right (a filter button in the header row). */
  getRightInset?(id: string): number
  /** False for a protected cell. */
  isCellEditable?(r: number, c: number): boolean
}

/** Events out, plus the bits of app state the editor needs. All optional. */
export interface GridHost {
  onSelect?(label: string): void
  onInput?(id: string, value: string): void
  onCommit?(id: string, value: string): void
  onCancel?(id: string): void
  onBatchCommit?(cells: { id: string; value: string }[]): void
  onFill?(src: CellBlock, total: SelRange, opts: { withModifier: boolean }): void
  onBlockedEdit?(): void
  onHyperlinkClick?(url: string): void
  onLinkHover?(info: LinkHover | null): void
  onDropdownClick?(id: string, rule: ValidationRule, pos: DropdownPos): void
  onCheckboxToggle?(id: string): void
  /** True when the host turned the double-click into a pivot drill-down. */
  onPivotDrill?(r: number, c: number): boolean | undefined
  onResizeEnd?(): void
  onColMove?(fromCol: number, toCol: number, count: number): void

  /** False for read-only viewers. Default true. */
  canEdit?(): boolean
  getSheetNames?(): string[]
  getCurrentSheet?(): string
  /** The sheet the formula being edited lives on, during a cross-sheet pick. */
  getEditingHomeSheet?(): string | null | undefined
}

export interface GridOptions {
  cells?: CellProvider
  host?: GridHost
  /** Read values through cells.getDisplay instead of the grid's own cache. */
  lazyValues?: boolean
}

export interface PxRect {
  x: number
  y: number
  width: number
  height: number
}

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
  ): { headerCol: number | null; headerRow: number | null; cell: Cell | null }

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

export type { Cell, IndexMap, SelMode, SelRange, SparkSpec, ValidationRule, ViewSnapshot }
