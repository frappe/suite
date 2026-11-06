/** The list's optional columns, in the rows' order. Name comes before them and the menu after. */
export const LIST_COLUMNS = ['access', 'kind', 'owner', 'size', 'modified'] as const

/** Column widths in pixels. Access sizes to its labels instead (`accessWidth`). */
export const COLUMN_WIDTHS: Record<string, number> = {
  owner: 192,
  modified: 128,
  kind: 128,
  size: 96,
}

/** Columns a phone has no room for. Name takes their width. */
export const WIDE_ONLY: ReadonlySet<string> = new Set(['access', 'owner', 'modified', 'kind'])

/**
 * The order columns give way in when the list is too narrow, first to go
 * first. Type repeats the icon, so it goes first; the date says the most at a
 * glance, so it stays longest. Name and the menu always stay.
 */
const DROP_ORDER = ['kind', 'size', 'owner', 'access', 'modified']

/** The narrowest Name column the desktop layout gives way for. */
const NAME_MIN_WIDTH = 240
const MENU_WIDTH = 40
/** The List's gap between columns. */
const COLUMN_GAP = 8
/** The icon and the gap after it. */
const ACCESS_ICON_WIDTH = 16 + 6
const ACCESS_MIN_WIDTH = 80
/** Room for "Anyone with the link"; a longer workspace name truncates. The width before any label shows. */
export const ACCESS_MAX_WIDTH = 160

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

/** The Access column's width for labels of these text widths: the widest, with its icon, within bounds. */
export function accessWidth(labelWidths: readonly number[]): number {
  const widest = Math.ceil(Math.max(0, ...labelWidths) + ACCESS_ICON_WIDTH)
  return Math.min(ACCESS_MAX_WIDTH, Math.max(ACCESS_MIN_WIDTH, widest))
}
