import type { DropdownOptions } from 'frappe-ui'
import { describe, expect, it, vi } from 'vitest'

import type { TableEditing } from './tableEditing'
import { cellMenu, columnMenu, rowMenu, tableMenu } from './tableMenus'
import type { TableTarget } from './useTableTarget'

const target: TableTarget = {
  cell: 10,
  row: 1,
  column: 2,
  kind: null,
  cellCount: 0,
  isMerged: false,
  hasHeaderRow: true,
}

function fakeTable(canDuplicate = true) {
  return {
    insertLine: vi.fn(),
    canDuplicateLine: vi.fn(() => canDuplicate),
    duplicateLine: vi.fn(),
    clearLine: vi.fn(),
    deleteLine: vi.fn(),
    deleteTable: vi.fn(),
    toggleHeaderRow: vi.fn(),
    mergeCells: vi.fn(),
    splitCell: vi.fn(),
    clearSelection: vi.fn(),
    setBackground: vi.fn(),
  }
}

type Item = {
  label?: string
  icon?: string
  theme?: string
  disabled?: boolean
  onClick?: () => void
}

/** Each entry as `label (icon)`, with groups as `[group: ...]` */
function outline(options: DropdownOptions): string[] {
  return options.map((option) => {
    if ('group' in option) {
      const inner = outline(option.options as DropdownOptions).join(', ')
      return `[${option.hideLabel ? '' : `${option.group}: `}${inner}]`
    }
    const item = option as Item
    return item.icon ? `${item.label} (${item.icon})` : `${item.label}`
  })
}

function click(options: DropdownOptions, label: string) {
  const items = options.flatMap((option) =>
    'group' in option ? (option.options as Item[]) : [option as Item],
  )
  const item = items.find((entry) => entry.label === label)
  if (!item?.onClick) throw new Error(`No item ${label}`)
  item.onClick()
}

const editorElement = document.createElement('div')

describe('table menus', () => {
  it('lists the row grip menu and runs each item on the row', () => {
    const table = fakeTable()
    const menu = rowMenu({ table: table as unknown as TableEditing, target, editorElement })
    expect(outline(menu)).toEqual([
      'Header row (lucide-panel-top)',
      '[Color: Color]',
      'Insert above (lucide-arrow-up-to-line)',
      'Insert below (lucide-arrow-down-to-line)',
      'Duplicate (lucide-copy)',
      'Clear content (lucide-eraser)',
      'Delete (lucide-trash-2)',
      '[Delete table (lucide-table-2)]',
    ])
    click(menu, 'Header row')
    click(menu, 'Insert above')
    click(menu, 'Insert below')
    click(menu, 'Duplicate')
    click(menu, 'Clear content')
    click(menu, 'Delete')
    click(menu, 'Delete table')
    expect(table.toggleHeaderRow).toHaveBeenCalledOnce()
    expect(table.insertLine.mock.calls).toEqual([
      ['row', 1, 'before'],
      ['row', 1, 'after'],
    ])
    expect(table.duplicateLine).toHaveBeenCalledWith('row', 1)
    expect(table.clearLine).toHaveBeenCalledWith('row', 1)
    expect(table.deleteLine).toHaveBeenCalledWith('row', 1)
    expect(table.deleteTable).toHaveBeenCalledOnce()
  })

  it('lists the column grip menu and runs each item on the column', () => {
    const table = fakeTable()
    const menu = columnMenu({ table: table as unknown as TableEditing, target, editorElement })
    expect(outline(menu)).toEqual([
      '[Color: Color]',
      'Insert left (lucide-arrow-left-to-line)',
      'Insert right (lucide-arrow-right-to-line)',
      'Duplicate (lucide-copy)',
      'Clear content (lucide-eraser)',
      'Delete (lucide-trash-2)',
      '[Delete table (lucide-table-2)]',
    ])
    click(menu, 'Insert left')
    click(menu, 'Insert right')
    click(menu, 'Duplicate')
    click(menu, 'Clear content')
    click(menu, 'Delete')
    expect(table.insertLine.mock.calls).toEqual([
      ['column', 2, 'before'],
      ['column', 2, 'after'],
    ])
    expect(table.duplicateLine).toHaveBeenCalledWith('column', 2)
    expect(table.clearLine).toHaveBeenCalledWith('column', 2)
    expect(table.deleteLine).toHaveBeenCalledWith('column', 2)
  })

  it('leaves Duplicate out when a copy would not keep the grid square', () => {
    const table = fakeTable(false)
    const menu = columnMenu({ table: table as unknown as TableEditing, target, editorElement })
    expect(outline(menu)).not.toContain('Duplicate (lucide-copy)')
    expect(table.canDuplicateLine).toHaveBeenCalledWith('column', 2)
  })

  it('lists the cell menu for a run of cells and for a merged cell', () => {
    const table = fakeTable()
    const run = { ...target, kind: 'cells' as const, cellCount: 4 }
    const menu = cellMenu({ table: table as unknown as TableEditing, target: run, editorElement })
    expect(outline(menu)).toEqual([
      '[Color: Color]',
      'Merge cells (lucide-table-cells-merge)',
      'Clear content (lucide-eraser)',
      '[Delete table (lucide-table-2)]',
    ])
    click(menu, 'Merge cells')
    click(menu, 'Clear content')
    expect(table.mergeCells).toHaveBeenCalledOnce()
    expect(table.clearSelection).toHaveBeenCalledOnce()

    const merged = { ...target, kind: 'cells' as const, cellCount: 1, isMerged: true }
    const split = cellMenu({
      table: table as unknown as TableEditing,
      target: merged,
      editorElement,
    })
    expect(outline(split)[1]).toBe('Split cell (lucide-table-cells-split)')
  })

  it('lists the toolbar table menu and runs each insert on the caret line', () => {
    const table = fakeTable()
    const menu = tableMenu({ table: table as unknown as TableEditing, target })
    expect(outline(menu)).toEqual([
      'Header row (lucide-panel-top)',
      '[Insert row above (lucide-arrow-up-to-line), Insert row below (lucide-arrow-down-to-line), Insert column left (lucide-arrow-left-to-line), Insert column right (lucide-arrow-right-to-line)]',
      '[Merge cells (lucide-table-cells-merge)]',
      '[Delete table (lucide-table-2)]',
    ])
    click(menu, 'Insert row above')
    click(menu, 'Insert row below')
    click(menu, 'Insert column left')
    click(menu, 'Insert column right')
    expect(table.insertLine.mock.calls).toEqual([
      ['row', 1, 'before'],
      ['row', 1, 'after'],
      ['column', 2, 'before'],
      ['column', 2, 'after'],
    ])
  })
})
