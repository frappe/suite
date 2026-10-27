import type { Attributes, CommandProps } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { CellSelection, isInTable, selectionCell } from '@tiptap/pm/tables'
import { TableCell, TableCellColor, TableHeader } from 'frappe-ui/editor'

import { isSameColour } from '@/apps/writer/utils/css-colour'

// frappe-ui's highlightColorHexMap, which it doesn't export: the colour each highlight name is drawn from
export const HIGHLIGHT_ANCHORS = new Map([
  ['red', '#fecaca'],
  ['orange', '#fed7aa'],
  ['yellow', '#fef08a'],
  ['green', '#bbf7d0'],
  ['teal', '#99f6e4'],
  ['cyan', '#a5f3fc'],
  ['blue', '#bfdbfe'],
  ['indigo', '#dbd5ff'],
  ['purple', '#e9d5ff'],
  ['pink', '#fbcfe8'],
  ['gray', '#e5e7eb'],
])

const BACKGROUND = 'background-color'
const SIDES = ['top', 'right', 'bottom', 'left']
const BORDER_PARTS = ['width', 'style', 'color']

// The cell properties Writer keeps and draws, as the longhands a browser reads them into: the
// border, padding, vertical alignment, overflow and background; overflow by its shorthand, which
// jsdom doesn't split
const KEPT_PROPERTIES = [
  ...SIDES.flatMap((side) => BORDER_PARTS.map((part) => `border-${side}-${part}`)),
  ...SIDES.map((side) => `padding-${side}`),
  'vertical-align',
  'overflow',
  'overflow-wrap',
  BACKGROUND,
]

// The same properties as style text may name them, shorthands included
const KEPT_NAMES = new Set([
  ...KEPT_PROPERTIES,
  'border',
  'padding',
  ...BORDER_PARTS.map((part) => `border-${part}`),
  ...SIDES.map((side) => `border-${side}`),
])

function styleOf(text: string) {
  const { style } = document.createElement('div')
  style.cssText = text
  return style
}

function propertyOf(piece: string) {
  const colon = piece.indexOf(':')
  if (colon < 0) {
    return ''
  }

  return piece.slice(0, colon).trim().toLowerCase()
}

// A declaration naming a kept property with a value the browser reads
function isKeptPiece(piece: string) {
  const name = propertyOf(piece)
  return KEPT_NAMES.has(name) && !!styleOf(piece).getPropertyValue(name)
}

// The highlight name a cell background is drawn as when it's exactly one: the editor's own variable or
// a palette colour as frappe-ui defines it; null for any other colour, which the style keeps
export function cellHighlightName(value: string) {
  const [, name = ''] = /^var\(--prose-highlight-([a-z]+)\)$/.exec(value.trim()) ?? []
  if (HIGHLIGHT_ANCHORS.has(name)) {
    return name
  }

  const found = [...HIGHLIGHT_ANCHORS].find(([, anchor]) => isSameColour(anchor, value))
  return found?.[0] ?? null
}

function isSameProperty(kept: CSSStyleDeclaration, source: CSSStyleDeclaration, name: string) {
  return (
    kept.getPropertyValue(name) === source.getPropertyValue(name) &&
    kept.getPropertyPriority(name) === source.getPropertyPriority(name)
  )
}

// The kept declarations of style text as written, so a shorthand reads back whole; rebuilt from the
// longhands when a declaration left out had overridden a kept one. Null when it keeps none
function keptStyle(text: string, leftOut = '') {
  const names = KEPT_PROPERTIES.filter((name) => name !== leftOut)
  const written = text
    .split(';')
    .filter((piece) => isKeptPiece(piece) && propertyOf(piece) !== leftOut)
    .map((piece) => piece.trim())
    .join('; ')
  const source = styleOf(text)
  const kept = styleOf(written)
  const isWhole = names.every((name) => isSameProperty(kept, source, name))
  if (isWhole && !written) {
    return null
  }

  if (isWhole) {
    return `${written};`
  }

  kept.cssText = ''
  for (const name of names.filter((property) => source.getPropertyValue(property))) {
    kept.setProperty(name, source.getPropertyValue(name), source.getPropertyPriority(name))
  }

  return kept.cssText || null
}

export function parseCellBackground(element: HTMLElement) {
  return cellHighlightName(element.style.getPropertyValue(BACKGROUND))
}

// A background the highlight name took is drawn by the name alone
export function parseCellStyle(element: HTMLElement) {
  const leftOut = parseCellBackground(element) ? BACKGROUND : ''
  return keptStyle(element.getAttribute('style') ?? '', leftOut)
}

function renderCellStyle(attrs: Record<string, unknown>) {
  const style = typeof attrs.style === 'string' && keptStyle(attrs.style)
  if (!style) {
    return {}
  }

  return { style }
}

// Read from the text, since jsdom drops the priority of a var() value
export function isImportantBackground(text: string) {
  return text
    .split(';')
    .some((piece) => propertyOf(piece) === BACKGROUND && /!\s*important/i.test(piece))
}

export function isKeptCellStyle(text: string) {
  return text
    .split(';')
    .filter((piece) => piece.trim())
    .every(isKeptPiece)
}

function withCellStyle(parent: Attributes = {}): Attributes {
  return {
    ...parent,
    backgroundColor: { ...parent.backgroundColor, parseHTML: parseCellBackground },
    style: { default: null, parseHTML: parseCellStyle, renderHTML: renderCellStyle },
  }
}

export const WriterTableCell = TableCell.extend({
  addAttributes() {
    return withCellStyle(this.parent?.())
  },
})

export const WriterTableHeader = TableHeader.extend({
  addAttributes() {
    return withCellStyle(this.parent?.())
  },
})

function selectedCells(state: EditorState) {
  const { selection } = state
  if (!(selection instanceof CellSelection)) {
    return [selectionCell(state).pos]
  }

  const positions: number[] = []
  selection.forEachCell((_cell, position) => positions.push(position))
  return positions
}

// Takes a pasted background out of the selected cells' styles; whether one held any
function dropStyleBackgrounds({ state, tr, dispatch }: CommandProps) {
  let isFound = false
  for (const position of selectedCells(state)) {
    const text: unknown = tr.doc.nodeAt(position)?.attrs.style
    const style = typeof text === 'string' && styleOf(text)
    if (!style || !style.getPropertyValue(BACKGROUND)) {
      continue
    }

    isFound = true
    style.removeProperty(BACKGROUND)
    if (dispatch) {
      tr.setNodeAttribute(position, 'style', style.cssText || null)
    }
  }

  return isFound
}

export const WriterTableCellColor = TableCellColor.extend({
  addCommands() {
    const commands = this.parent?.() ?? {}
    return {
      ...commands,
      // Setting or clearing a cell's colour also drops a pasted one, so a clear shows none; the
      // table's own command does nothing when the cell already holds the name
      setCellBackground: (name: string | null) => (props: CommandProps) => {
        const isSet = !!commands.setCellBackground?.(name)(props)
        const isPalette = name === null || HIGHLIGHT_ANCHORS.has(name)
        if (!isSet && !(isPalette && isInTable(props.state))) {
          return false
        }

        return dropStyleBackgrounds(props) || isSet
      },
    }
  },
})
