import { Editor } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { afterEach, describe, expect, it } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { INSERTS } from '../inserts'
import { TableEditing } from './tableEditing'
import { tableMenu } from './tableMenus'
import { landingIndex, TableShape } from './tableShape'
import { selectionTarget } from './useTableTarget'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

const cell = (tag: string, text: string) => `<${tag}><p>${text}</p></${tag}>`
const row = (tag: string, ...texts: string[]) =>
  `<tr>${texts.map((t) => cell(tag, t)).join('')}</tr>`

/** A 3x3 table with a header row, inside a Writer tab */
function open() {
  const table = `<table>${row('th', 'Name', 'Role', 'Team')}${row('td', 'Ann', 'Dev', 'Core')}${row('td', 'Bo', 'Ops', 'Infra')}</table>`
  editor = new Editor({
    extensions: writerSchema(),
    content: `<div data-tab-id="t1" data-tab-label="One"><p>Intro</p>${table}</div>`,
  })
  return { editor, table: editing(editor) }
}

function editing(target: Editor) {
  let first = -1
  target.state.doc.descendants((node, pos) => {
    if (first < 0 && node.type.name === 'tableHeader') first = pos
  })
  return new TableEditing(target, first)
}

/** The table's text, row by row, with header cells in capitals */
function grid(target: Editor) {
  const rows: string[][] = []
  target.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') {
      rows.push(
        node.children.map((c) =>
          c.type.name === 'tableHeader' ? c.textContent.toUpperCase() : c.textContent,
        ),
      )
      return false
    }
    return true
  })
  return rows
}

describe('table editing', () => {
  it("puts the caret in the row or column that takes a deleted one's place", () => {
    const { editor } = open()
    const dev = cellOf(editor, 'Dev')
    new TableEditing(editor, dev).deleteLine('row', 1)
    expect(editor.state.selection.$head.parent.textContent).toBe('Ops')

    new TableEditing(editor, cellOf(editor, 'Infra')).deleteLine('column', 2)
    expect(editor.state.selection.$head.parent.textContent).toBe('Ops')
  })

  it('inserts, duplicates and deletes rows and columns in a table inside a tab', () => {
    const { editor, table } = open()

    table.insertLine('row', 1, 'after')
    expect(grid(editor).map((r) => r[0])).toEqual(['NAME', 'Ann', '', 'Bo'])

    table.duplicateLine('row', 3)
    expect(grid(editor).map((r) => r[0])).toEqual(['NAME', 'Ann', '', 'Bo', 'Bo'])

    table.insertLine('column', 0, 'before')
    expect(grid(editor)[1]).toEqual(['', 'Ann', 'Dev', 'Core'])

    table.deleteLine('column', 0)
    table.deleteLine('row', 2)
    expect(grid(editor)).toEqual([
      ['NAME', 'ROLE', 'TEAM'],
      ['Ann', 'Dev', 'Core'],
      ['Bo', 'Ops', 'Infra'],
      ['Bo', 'Ops', 'Infra'],
    ])

    table.duplicateLine('column', 2)
    expect(grid(editor)[1]).toEqual(['Ann', 'Dev', 'Core', 'Core'])
  })

  it('adds a row and a column at the end', () => {
    const { editor, table } = open()
    table.addLineAtEnd('row')
    table.addLineAtEnd('column')
    expect(grid(editor)).toHaveLength(4)
    expect(grid(editor)[3]).toEqual(['', '', '', ''])
    expect(grid(editor)[0]).toHaveLength(4)
  })

  it('puts the caret in the new row or column, so typing fills it', () => {
    const { editor, table } = open()
    table.addLineAtEnd('row')
    editor.commands.insertContent('Cy')
    expect(grid(editor)[3]).toEqual(['Cy', '', ''])

    table.addLineAtEnd('column')
    editor.commands.insertContent('Notes')
    expect(grid(editor).map((r) => r[3])).toEqual(['NOTES', '', '', ''])

    table.insertLine('row', 1, 'before')
    editor.commands.insertContent('Al')
    expect(grid(editor).map((r) => r[0])).toEqual(['NAME', 'Al', 'Ann', 'Bo', 'Cy'])
  })

  it('moves a row below the header and keeps the header row first', () => {
    const { editor, table } = open()
    table.moveLine('row', 0, 2)
    expect(grid(editor)).toEqual([
      ['ANN', 'DEV', 'CORE'],
      ['Bo', 'Ops', 'Infra'],
      ['Name', 'Role', 'Team'],
    ])
    const { selection } = editor.state
    expect(selection instanceof CellSelection && selection.isRowSelection()).toBe(true)
  })

  it('moves a column with its cells', () => {
    const { editor, table } = open()
    table.moveLine('column', 2, 0)
    expect(grid(editor)[0]).toEqual(['TEAM', 'NAME', 'ROLE'])
    expect(grid(editor)[2]).toEqual(['Infra', 'Bo', 'Ops'])
  })

  it('clears a column, colours a row and toggles the header row', () => {
    const { editor, table } = open()
    table.clearLine('column', 1)
    expect(grid(editor).map((r) => r[1])).toEqual(['', '', ''])

    table.setBackground('blue', { axis: 'row', index: 1 })
    const colours = editor.state.doc.nodeAt(table.shape?.cellPos(1, 2) ?? 0)?.attrs.backgroundColor
    expect(colours).toBe('blue')

    table.toggleHeaderRow()
    expect(grid(editor)[0]).toEqual(['Name', '', 'Team'])
  })

  it('puts the caret back at the end of a cell', () => {
    const { editor, table } = open()
    const cell = table.shape?.cellPos(1, 1) ?? 0
    new TableEditing(editor, cell).focusCell()
    editor.commands.insertContent('!')
    expect(grid(editor)[1]).toEqual(['Ann', 'Dev!', 'Core'])
  })

  it('deletes the whole table with its last row, and undo brings it back', () => {
    const { editor, table } = open()
    table.deleteLine('row', 0)
    table.deleteLine('row', 0)
    expect(grid(editor)).toEqual([['Bo', 'Ops', 'Infra']])
    table.deleteLine('row', 0)
    expect(grid(editor)).toHaveLength(0)
    expect(editor.state.doc.firstChild?.type.name).toBe('tab')

    editor.commands.undo()
    expect(grid(editor).length).toBeGreaterThan(0)
  })
})

describe('inside a table', () => {
  const tableInsert = INSERTS.find((insert) => insert.label === 'Table')

  it('offers table options instead of a new table, and merges only a run of cells', () => {
    const { editor, table } = open()
    expect(tableInsert?.isAvailable(editor)).toBe(true)

    const cell = table.shape?.cellPos(1, 0) ?? 0
    editor.commands.setTextSelection(cell + 2)
    expect(tableInsert?.isAvailable(editor)).toBe(false)
    const mergeOf = () => {
      const target = selectionTarget(editor)
      const menu = target ? tableMenu({ table: new TableEditing(editor, target.cell), target }) : []
      const items = menu.flatMap((item) => ('options' in item ? item.options : [item]))
      return items.find((item) => item.label === 'Merge cells')
    }
    expect(mergeOf()?.disabled).toBe(true)

    editor.commands.setCellSelection({
      anchorCell: cell,
      headCell: table.shape?.cellPos(1, 1) ?? 0,
    })
    expect(mergeOf()?.disabled).toBe(false)
  })
})

describe('landing a dragged line', () => {
  const edges = [0, 40, 80, 120, 160]

  it('lands on the nearest edge, counted after the line leaves', () => {
    expect(landingIndex(edges, 150, 0)).toBe(3)
    expect(landingIndex(edges, 5, 3)).toBe(0)
    expect(landingIndex(edges, 85, 0)).toBe(1)
  })

  it('does not move when the nearest edge is the line’s own', () => {
    expect(landingIndex(edges, 45, 1)).toBeNull()
    expect(landingIndex(edges, 78, 1)).toBeNull()
  })
})

describe('table shape', () => {
  it('reports header rows and refuses to move a column past merged cells', () => {
    const { editor } = open()
    const shape = editing(editor).shape
    expect(shape?.headerRows).toBe(1)
    expect(shape?.canMove('column')).toBe(true)

    editor.commands.setCellSelection({
      anchorCell: shape?.cellPos(1, 0) ?? 0,
      headCell: shape?.cellPos(1, 1) ?? 0,
    })
    editor.commands.mergeCells()
    const merged = TableShape.at(editor.state.doc, shape?.cellPos(0, 0) ?? 0)
    expect(merged?.canMove('column')).toBe(false)
    expect(merged?.canMove('row')).toBe(true)
  })
})

function cellOf(target: Editor, text: string) {
  let found = -1
  target.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.spec.tableRole && node.textContent === text) found = pos
  })
  return found
}
