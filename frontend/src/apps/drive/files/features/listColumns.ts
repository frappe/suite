/** The list's optional columns, in the rows' order. Name comes before them and the menu after. */
export const LIST_COLUMNS = ['access', 'kind', 'owner', 'size', 'modified'] as const

/**
 * Size and Modified fit their longest value, such as "1023.9 KB"
 * and "Sep 28, 2025", and the other columns their widest label (`MEASURED_COLUMNS`).
 */
export const FITTED_WIDTHS = new Map([
  ['size', 72],
  ['modified', 96],
])

/**
 * The columns sized to their widest label: the room beside the label (an icon
 * or an avatar and its gap) and the bounds. The widest is the width before any
 * label shows, and a longer label truncates. Access always sizes this way;
 * Type and Owner too.
 */
export const MEASURED_COLUMNS = {
  // Room for "Anyone with the link"; a longer workspace name truncates.
  access: { beside: 16 + 6, min: 80, max: 160 },
  // Room for "Spreadsheet", and for the header with its sort arrow.
  kind: { beside: 0, min: 56, max: 112 },
  // Room for a typical name such as "Leo Fernandes".
  owner: { beside: 16 + 8, min: 96, max: 160 },
} as const

export type MeasuredColumn = keyof typeof MEASURED_COLUMNS

export function isMeasuredColumn(column: string | null): column is MeasuredColumn {
  return !!column && column in MEASURED_COLUMNS
}

/** Columns a phone has no room for. Name takes their width. */
export const WIDE_ONLY: ReadonlySet<string> = new Set(['access', 'owner', 'modified', 'kind'])

/** The List's gap between columns on a desktop list (`md:list-gap-6`). */
const COLUMN_GAP = 24

/**
 * The order columns give way in when the list is too narrow, first to go
 * first. Type repeats the icon, so it goes first; the date says the most at a
 * glance, so it stays longest. Name and the menu always stay.
 */
const DROP_ORDER = ['kind', 'size', 'owner', 'access', 'modified']

/** The narrowest Name column the desktop layout gives way for. */
const NAME_MIN_WIDTH = 240
const MENU_WIDTH = 40

/**
 * The columns that fit a list `room` pixels wide beside a Name column of at
 * least `NAME_MIN_WIDTH`, dropping columns in `DROP_ORDER` until they do.
 */
export function fitColumns(
  columns: readonly string[],
  room: number,
  widthOf: (column: string) => number,
): string[] {
  let shown = [...columns]
  const needed = () =>
    NAME_MIN_WIDTH +
    MENU_WIDTH +
    shown.reduce((sum, column) => sum + widthOf(column), 0) +
    (shown.length + 1) * COLUMN_GAP
  for (const column of DROP_ORDER) {
    if (needed() <= room) break
    shown = shown.filter((item) => item !== column)
  }
  return shown
}

/** A measured column's width for labels of these text widths: the widest, with what sits beside it, within bounds. */
export function measuredWidth(column: MeasuredColumn, labelWidths: readonly number[]): number {
  const { beside, min, max } = MEASURED_COLUMNS[column]
  const widest = Math.ceil(Math.max(0, ...labelWidths) + beside)
  return Math.min(max, Math.max(min, widest))
}
