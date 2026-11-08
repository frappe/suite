import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'

// Cell fill anchors from frappe-ui src/molecules/editor/extensions/shared/color-palette.ts (gray left out)
const FILLS: Record<string, string> = {
  red: '#fecaca',
  orange: '#fed7aa',
  yellow: '#fef08a',
  green: '#bbf7d0',
  teal: '#99f6e4',
  cyan: '#a5f3fc',
  blue: '#bfdbfe',
  indigo: '#dbd5ff',
  purple: '#e9d5ff',
  pink: '#fbcfe8',
}
/** Below this spread between the strongest and weakest channel, a fill counts as white or gray */
const MIN_CHROMA = 10

/**
 * Tables pasted into Writer and copied out of it:
 * - Pasted cell fills take the palette colour nearest in hue, so the pale fills of Google Sheets
 *   and Docs keep their colour. Whites and grays are dropped.
 * - A pasted table from outside Writer with only some column widths set loses them all, so the
 *   columns share the width evenly.
 * - Pasting a block of cells over one selected cell fills the cells from there, as at a caret.
 * - Copied cells read as tab-separated rows in other apps.
 */
export const TablePaste = Extension.create({
  name: 'tablePaste',
  // Ahead of tiptap's own clipboard text and prosemirror-tables' paste
  priority: 210,

  addProseMirrorPlugins() {
    let isExternal = false
    return [
      new Plugin({
        key: new PluginKey('tablePaste'),
        props: {
          transformPastedHTML(html) {
            // Writer marks what it copies
            isExternal = !html.includes('data-pm-slice')
            return isExternal ? withPaletteFills(html) : html
          },
          transformPasted(slice) {
            const result = isExternal ? withEvenColumns(slice) : slice
            isExternal = false
            return result
          },
          handlePaste(view, _event, slice) {
            const { selection } = view.state
            if (!(selection instanceof CellSelection) || !isTableSlice(slice)) return false
            if (selection.$anchorCell.pos !== selection.$headCell.pos) return false
            // prosemirror-tables clips a pasted block to the selected cells, but not at a caret
            const caret = TextSelection.near(view.state.doc.resolve(selection.$anchorCell.pos + 1))
            view.dispatch(view.state.tr.setSelection(caret))
            return false
          },
          clipboardTextSerializer(slice, view) {
            if (!(view.state.selection instanceof CellSelection)) return ''
            return cellsAsText(slice)
          },
        },
      }),
    ]
  },
})

/** `html` with each cell's fill replaced by the nearest palette colour, or removed */
export function withPaletteFills(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  for (const cell of template.content.querySelectorAll<HTMLElement>('td[style], th[style]')) {
    const name = paletteFill(cell.style.backgroundColor)
    if (name) cell.style.backgroundColor = `var(--prose-highlight-${name})`
    else cell.style.removeProperty('background-color')
  }
  return template.innerHTML
}

/** The palette fill nearest in hue to a CSS colour, or null for none, white or gray */
export function paletteFill(color: string): string | null {
  const rgb = parseRgb(color)
  if (!rgb || Math.max(...rgb) - Math.min(...rgb) < MIN_CHROMA) return null
  const target = hueOf(rgb)
  let nearest: string | null = null
  let distance = Infinity
  for (const [name, hex] of Object.entries(FILLS)) {
    const gap = Math.abs(hueOf(hexToRgb(hex)) - target)
    const around = Math.min(gap, 360 - gap)
    if (around < distance) [nearest, distance] = [name, around]
  }
  return nearest
}

function parseRgb(color: string): number[] | null {
  if (color.startsWith('#')) return hexToRgb(color)
  const channels = /rgba?\(([^)]+)\)/
    .exec(color)?.[1]
    .split(/[\s,/]+/)
    .map(Number)
  if (!channels || channels.length < 3 || channels.slice(0, 3).some(Number.isNaN)) return null
  if (channels.length > 3 && channels[3] === 0) return null
  return channels.slice(0, 3)
}

function hexToRgb(hex: string): number[] {
  const digits = hex.slice(1)
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits
  return [0, 2, 4].map((start) => parseInt(full.slice(start, start + 2), 16))
}

/** The HSL hue, in degrees */
function hueOf([red, green, blue]: number[]): number {
  const max = Math.max(red, green, blue)
  const spread = max - Math.min(red, green, blue)
  if (spread === 0) return 0
  const hue =
    max === red
      ? (green - blue) / spread
      : max === green
        ? (blue - red) / spread + 2
        : (red - green) / spread + 4
  return (hue * 60 + 360) % 360
}

function isTableSlice(slice: Slice) {
  let hasTable = false
  slice.content.forEach((node) => (hasTable ||= !!node.type.spec.tableRole))
  return hasTable
}

/** Tables in `slice` with mixed column widths lose them all */
export function withEvenColumns(slice: Slice): Slice {
  return new Slice(evenTables(slice.content), slice.openStart, slice.openEnd)
}

function evenTables(fragment: Fragment): Fragment {
  const nodes: PMNode[] = []
  fragment.forEach((node) => {
    if (node.type.spec.tableRole === 'table')
      nodes.push(hasMixedWidths(node) ? withoutWidths(node) : node)
    else nodes.push(node.isLeaf ? node : node.copy(evenTables(node.content)))
  })
  return Fragment.from(nodes)
}

function hasMixedWidths(table: PMNode) {
  const widths = new Set<boolean>()
  table.descendants((node) => {
    if (!isCell(node)) return true
    widths.add(!!node.attrs.colwidth)
    return false
  })
  return widths.size > 1
}

function withoutWidths(table: PMNode): PMNode {
  const rows: PMNode[] = []
  table.forEach((row) => {
    const cells: PMNode[] = []
    row.forEach((cell) => {
      cells.push(
        isCell(cell)
          ? cell.type.create({ ...cell.attrs, colwidth: null }, cell.content, cell.marks)
          : cell,
      )
    })
    rows.push(row.copy(Fragment.from(cells)))
  })
  return table.copy(Fragment.from(rows))
}

function isCell(node: PMNode) {
  const role = node.type.spec.tableRole
  return role === 'cell' || role === 'header_cell'
}

/** Copied cells as text: tabs between cells, a line per row */
function cellsAsText(slice: Slice): string {
  const rows: string[] = []
  slice.content.descendants((node) => {
    if (node.type.spec.tableRole !== 'row') return true
    const cells: string[] = []
    node.forEach((cell) => cells.push(cell.textBetween(0, cell.content.size, ' ')))
    rows.push(cells.join('\t'))
    return false
  })
  return rows.join('\n')
}
