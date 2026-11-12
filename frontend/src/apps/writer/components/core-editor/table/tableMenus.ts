import type { DropdownOptions } from 'frappe-ui'
import { h } from 'vue'

import { translate as __ } from '@/platform/translation'

import CellColorSwatches from './CellColorSwatches.vue'
import type { TableEditing } from './tableEditing'
import type { Axis } from './tableShape'
import type { TableTarget } from './useTableTarget'

type Option = DropdownOptions[number]
type ActionOption = Exclude<Option, { group: string }>

type Line = { axis: Axis; index: number }

interface MenuContext {
  table: TableEditing
  target: TableTarget
  editorElement: Element
}

export const rowMenu = (context: MenuContext) => lineMenu('row', context)
export const columnMenu = (context: MenuContext) => lineMenu('column', context)

/** A row or column grip's menu */
function lineMenu(axis: Axis, { table, target, editorElement }: MenuContext): DropdownOptions {
  const line = { axis, index: target[axis] }
  const labels: [string, string] =
    axis === 'row'
      ? [__('Insert above'), __('Insert below')]
      : [__('Insert left'), __('Insert right')]
  return [
    // The table's first row, offered from every row so it is found from wherever the grip is
    ...(axis === 'row' ? [headerRowItem(table, target)] : []),
    colorItem(editorElement, (name) => table.setBackground(name, line)),
    ...insertItems(table, line, labels),
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
        ...insertItems(table, { axis: 'row', index: target.row }, [
          __('Insert row above'),
          __('Insert row below'),
        ]),
        ...insertItems(table, { axis: 'column', index: target.column }, [
          __('Insert column left'),
          __('Insert column right'),
        ]),
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

const INSERT_ICONS = {
  row: ['lucide-arrow-up-to-line', 'lucide-arrow-down-to-line'],
  column: ['lucide-arrow-left-to-line', 'lucide-arrow-right-to-line'],
} as const

/** Insert before and after a line, labelled for where they are offered */
function insertItems(table: TableEditing, line: Line, labels: [string, string]): ActionOption[] {
  return (['before', 'after'] as const).map((side, i) => ({
    label: labels[i],
    icon: INSERT_ICONS[line.axis][i],
    onClick: () => table.insertLine(line.axis, line.index, side),
  }))
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

function lineItems(table: TableEditing, line: Line): DropdownOptions {
  return [
    ...(table.canDuplicateLine(line.axis, line.index)
      ? [
          {
            label: __('Duplicate'),
            icon: 'lucide-copy',
            onClick: () => table.duplicateLine(line.axis, line.index),
          },
        ]
      : []),
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
