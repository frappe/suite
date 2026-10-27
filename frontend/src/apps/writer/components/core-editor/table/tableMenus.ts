import type { DropdownOptions } from 'frappe-ui'
import { h } from 'vue'

import { translate as __ } from '@/platform/translation'

import CellColorSwatches from './CellColorSwatches.vue'
import type { TableEditing } from './tableEditing'
import type { Axis } from './tableShape'
import type { TableTarget } from './useTableTarget'

type Option = DropdownOptions[number]
type ActionOption = Exclude<Option, { group: string }>

interface MenuContext {
  table: TableEditing
  target: TableTarget
  editorElement: Element
}

/** The row grip's menu */
export function rowMenu({ table, target, editorElement }: MenuContext): DropdownOptions {
  const line = { axis: 'row' as const, index: target.row }
  return [
    // The table's first row, offered from every row so it is found from wherever the grip is
    headerRowItem(table, target),
    colorItem(editorElement, (name) => table.setBackground(name, line)),
    {
      label: __('Insert above'),
      icon: 'lucide-arrow-up-to-line',
      onClick: () => table.insertLine('row', target.row, 'before'),
    },
    {
      label: __('Insert below'),
      icon: 'lucide-arrow-down-to-line',
      onClick: () => table.insertLine('row', target.row, 'after'),
    },
    ...lineItems(table, line),
  ]
}

/** The column grip's menu */
export function columnMenu({ table, target, editorElement }: MenuContext): DropdownOptions {
  const line = { axis: 'column' as const, index: target.column }
  return [
    colorItem(editorElement, (name) => table.setBackground(name, line)),
    {
      label: __('Insert left'),
      icon: 'lucide-arrow-left-to-line',
      onClick: () => table.insertLine('column', target.column, 'before'),
    },
    {
      label: __('Insert right'),
      icon: 'lucide-arrow-right-to-line',
      onClick: () => table.insertLine('column', target.column, 'after'),
    },
    ...lineItems(table, line),
  ]
}

/** The menu of a run of selected cells */
export function cellMenu({ table, target, editorElement }: MenuContext): DropdownOptions {
  const merge: Option[] =
    target.cellCount > 1 ? [mergeItem(table, target)] : target.isMerged ? [splitItem(table)] : []
  return [
    colorItem(editorElement, (name) => table.setBackground(name)),
    ...merge,
    { label: __('Clear content'), icon: 'lucide-eraser', onClick: () => table.clearSelection() },
    deleteTableGroup(table),
  ]
}

/** The toolbar's Table menu while the selection is in a table: every table-wide action in one place */
export function tableMenu({ table, target }: Omit<MenuContext, 'editorElement'>): DropdownOptions {
  return [
    headerRowItem(table, target),
    {
      group: 'insert',
      hideLabel: true,
      options: [
        {
          label: __('Insert row above'),
          icon: 'lucide-arrow-up-to-line',
          onClick: () => table.insertLine('row', target.row, 'before'),
        },
        {
          label: __('Insert row below'),
          icon: 'lucide-arrow-down-to-line',
          onClick: () => table.insertLine('row', target.row, 'after'),
        },
        {
          label: __('Insert column left'),
          icon: 'lucide-arrow-left-to-line',
          onClick: () => table.insertLine('column', target.column, 'before'),
        },
        {
          label: __('Insert column right'),
          icon: 'lucide-arrow-right-to-line',
          onClick: () => table.insertLine('column', target.column, 'after'),
        },
      ],
    },
    {
      group: 'cells',
      hideLabel: true,
      // Shown while one cell is selected too, so it is clear that merging is done here
      options: [mergeItem(table, target), ...(target.isMerged ? [splitItem(table)] : [])],
    },
    deleteTableGroup(table),
  ]
}

function headerRowItem(table: TableEditing, target: TableTarget): ActionOption {
  return {
    label: __('Header row'),
    icon: 'lucide-panel-top',
    switch: true,
    switchValue: target.hasHeaderRow,
    onClick: () => table.toggleHeaderRow(),
  }
}

function mergeItem(table: TableEditing, target: TableTarget): ActionOption {
  return {
    label: __('Merge cells'),
    icon: 'lucide-table-cells-merge',
    description: target.cellCount > 1 ? undefined : __('Select two or more cells first'),
    disabled: target.cellCount < 2,
    onClick: () => table.mergeCells(),
  }
}

function splitItem(table: TableEditing): ActionOption {
  return {
    label: __('Split cell'),
    icon: 'lucide-table-cells-split',
    onClick: () => table.splitCell(),
  }
}

function lineItems(table: TableEditing, line: { axis: Axis; index: number }): DropdownOptions {
  return [
    {
      label: __('Duplicate'),
      icon: 'lucide-copy',
      onClick: () => table.duplicateLine(line.axis, line.index),
    },
    {
      label: __('Clear content'),
      icon: 'lucide-eraser',
      onClick: () => table.clearLine(line.axis, line.index),
    },
    {
      label: __('Delete'),
      icon: 'lucide-trash-2',
      onClick: () => table.deleteLine(line.axis, line.index),
    },
    deleteTableGroup(table),
  ]
}

function deleteTableGroup(table: TableEditing): Option {
  return {
    group: 'table',
    hideLabel: true,
    options: [
      {
        label: __('Delete table'),
        icon: 'lucide-table-2',
        theme: 'red',
        onClick: () => table.deleteTable(),
      },
    ],
  }
}

function colorItem(editorElement: Element, apply: (name: string | null) => void): Option {
  return {
    group: __('Color'),
    options: [
      {
        label: __('Color'),
        slots: {
          item: ({ close }) =>
            h(CellColorSwatches, {
              editorElement,
              onPick: (name: string | null) => {
                apply(name)
                close()
              },
            }),
        },
      },
    ],
  }
}
