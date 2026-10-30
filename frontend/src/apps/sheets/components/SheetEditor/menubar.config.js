// The menu bar's six menus (File, Edit, View, Insert, Format, Data). Every
// action the toolbar, the right-click menu or a shortcut offers is listed here
// by name, so the toolbar can stay short. `a` holds the editor's callbacks and
// state; the factory only arranges them. Each menu has a `key` to find it
// by, since its label is translated.

import { translate as __ } from '@/platform/translation'

const item = (label, icon, onClick, extra = {}) => ({ label, icon, onClick, ...extra })

/** Drops the items a viewer can't use; a group left empty goes too. */
function forViewers(groups, readOnly) {
  if (!readOnly) return groups
  return groups
    .map((g) => ({ ...g, options: g.options.filter((o) => !o.write) }))
    .filter((g) => g.options.length > 0)
}

/** Dropdown groups re-used as a submenu (alignment, borders, number formats). */
const submenu = (label, icon, groups, extra = {}) => ({ label, icon, submenu: groups, ...extra })

export function buildMenuBar(a) {
  const edit = [
    {
      group: 'History',
      hideLabel: true,
      options: [
        item(__('Undo'), 'lucide-undo-2', a.undo, { write: true, disabled: !a.canUndo }),
        item(__('Redo'), 'lucide-redo-2', a.redo, { write: true, disabled: !a.canRedo }),
      ],
    },
    {
      group: 'Cells',
      hideLabel: true,
      options: [
        item(__('Find and replace'), 'lucide-text-search', a.openFindReplace),
        submenu(__('Paste special'),
          'lucide-clipboard',
          [
            item(__('Values only'), 'lucide-clipboard', () => a.pasteSpecial('values')),
            item(__('Formats only'), 'lucide-clipboard', () => a.pasteSpecial('formats')),
            item(__('Formulas only'), 'lucide-clipboard', () => a.pasteSpecial('formulas')),
          ],
          { write: true, disabled: !a.canPaste },
        ),
        item(__('Clear contents'), 'lucide-eraser', a.clearContents, { write: true }),
      ],
    },
    {
      group: 'Rows and columns',
      hideLabel: true,
      options: [
        item(__('Delete rows'), 'lucide-trash-2', a.deleteRows, { write: true }),
        item(__('Delete columns'), 'lucide-trash-2', a.deleteCols, { write: true }),
        item(__('Move column left'), 'lucide-chevron-left', a.moveColLeft, { write: true }),
        item(__('Move column right'), 'lucide-chevron-right', a.moveColRight, { write: true }),
      ],
    },
  ]

  const view = [
    {
      group: 'Zoom',
      hideLabel: true,
      options: [
        item(__('Zoom in'), 'lucide-zoom-in', a.zoomIn),
        item(__('Zoom out'), 'lucide-zoom-out', a.zoomOut),
        item(__('Reset zoom'), 'lucide-search', a.resetZoom),
      ],
    },
    {
      group: 'Freeze',
      hideLabel: true,
      options: [
        submenu(__('Freeze'),
          'lucide-snowflake',
          [
            item(__('Rows up to the current row'), 'lucide-snowflake', a.freezeRows),
            item(__('Columns up to the current column'), 'lucide-snowflake', a.freezeCols),
            item(__('Unfreeze rows'), 'lucide-x', a.unfreezeRows, { disabled: !a.frozenRows }),
            item(__('Unfreeze columns'), 'lucide-x', a.unfreezeCols, { disabled: !a.frozenCols }),
          ],
          { write: true },
        ),
        item(__('Hide rows'), 'lucide-eye-off', a.hideRows, { write: true }),
        item(__('Hide columns'), 'lucide-eye-off', a.hideCols, { write: true }),
        ...(a.hasHiddenRows
          ? [item(__('Unhide all rows'), 'lucide-eye', a.unhideAllRows, { write: true })]
          : []),
        ...(a.hasHiddenCols
          ? [item(__('Unhide all columns'), 'lucide-eye', a.unhideAllCols, { write: true })]
          : []),
      ],
    },
    {
      group: 'Show',
      hideLabel: true,
      options: [
        item(
          a.showFormulas ? __('Show values') : __('Show formulas'),
          'lucide-sigma',
          a.toggleShowFormulas,
        ),
        item(
          a.notesCount ? __('Notes ({0})', [a.notesCount]) : __('Notes'),
          'lucide-sticky-note',
          a.toggleNotes,
        ),
        item(__('Keyboard shortcuts'), 'lucide-keyboard', a.openShortcuts),
      ],
    },
  ]

  const insert = [
    {
      group: 'Rows and columns',
      hideLabel: true,
      options: [
        item(__('Row above'), 'lucide-arrow-up', a.insertRowAbove),
        item(__('Row below'), 'lucide-arrow-down', a.insertRowBelow),
        item(__('Rows…'), 'lucide-plus', a.insertRows),
        item(__('Column left'), 'lucide-arrow-left', a.insertColLeft),
        item(__('Column right'), 'lucide-arrow-right', a.insertColRight),
        item(__('Columns…'), 'lucide-plus', a.insertCols),
      ].map((o) => ({ ...o, write: true })),
    },
    {
      group: 'Objects',
      hideLabel: true,
      options: [
        item(__('Chart…'), 'lucide-chart-bar', a.insertChart),
        item(__('Pivot table…'), 'lucide-table-2', a.insertPivot),
        item(__('Slicer'), 'lucide-list-filter', a.insertSlicer),
      ].map((o) => ({ ...o, write: true })),
    },
    {
      group: 'Cells',
      hideLabel: true,
      options: [
        item(__('Link…'), 'lucide-link', a.insertLink, { write: true }),
        item(__('Checkbox'), 'lucide-square-check', a.insertCheckbox, { write: true }),
        item(__('Dropdown'), 'lucide-chevron-down', a.insertDropdown, { write: true }),
        item(__('Note'), 'lucide-sticky-note', a.insertNote, { write: true }),
      ],
    },
  ]

  const format = [
    {
      group: 'Number',
      hideLabel: true,
      options: [
        submenu(__('Number'), 'lucide-hash', a.numberFormatOptions),
        submenu(__('Currency'), 'lucide-dollar-sign', a.currencyOptions),
        item(__('Percent'), 'lucide-percent', () => a.numberFormat('percentage')),
        item(__('Thousands separator'), 'lucide-hash', () => a.numberFormat('number')),
        item(__('Fewer decimal places'), 'lucide-decimals-arrow-left', () => a.adjustDecimals(-1)),
        item(__('More decimal places'), 'lucide-decimals-arrow-right', () => a.adjustDecimals(+1)),
      ],
    },
    {
      group: 'Text',
      hideLabel: true,
      options: [
        item(__('Bold'), 'lucide-bold', () => a.toggleFormat('bold')),
        item(__('Italic'), 'lucide-italic', () => a.toggleFormat('italic')),
        item(__('Underline'), 'lucide-underline', () => a.toggleFormat('underline')),
        item(__('Strikethrough'), 'lucide-strikethrough', () => a.toggleFormat('strikethrough')),
        submenu(__('Font'), 'lucide-type', a.fontFamilyOptions),
      ],
    },
    {
      group: 'Layout',
      hideLabel: true,
      options: [
        submenu(__('Alignment'), 'lucide-align-left', a.alignOptions),
        submenu(__('Wrapping'), 'lucide-wrap-text', a.wrapOptions),
        item(__('Merge cells'), 'lucide-table-cells-merge', a.toggleMerge),
        submenu(__('Borders'), 'lucide-grid-2x2', a.borderOptions),
        item(__('Fit row height'), 'lucide-move-vertical', a.autoFitRows),
        item(__('Fit column width'), 'lucide-move-horizontal', a.autoFitCols),
      ],
    },
    {
      group: 'Rules',
      hideLabel: true,
      options: [
        item(__('Conditional formatting…'), 'lucide-blend', a.openConditionalFormat),
        item(__('Format painter'), 'lucide-paint-roller', a.toggleFormatPainter),
        item(__('Clear formatting'), 'lucide-remove-formatting', a.clearFormatting),
      ],
    },
  ].map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, write: true })) }))

  const data = [
    {
      group: 'Sort and filter',
      hideLabel: true,
      options: [
        item(__('Sort and filter this column'), 'lucide-arrow-down-wide-narrow', a.sortColumn, {
          write: true,
        }),
        item(a.filterOn ? __('Remove filter') : __('Create a filter'), 'lucide-funnel', a.toggleFilter, {
          write: true,
        }),
      ],
    },
    {
      group: 'Cells',
      hideLabel: true,
      options: [
        item(__('Data validation…'), 'lucide-list-checks', a.openValidation, { write: true }),
        item(__('Named ranges…'), 'lucide-bookmark', a.openNamedRanges, { write: true }),
        item(__('Split text to columns'), 'lucide-columns-2', a.splitText, { write: true }),
        item(__('Smart Fill'), 'lucide-zap', a.smartFill, { write: true }),
      ],
    },
    {
      group: 'Protect',
      hideLabel: true,
      options: [
        item(__('Protect range'), 'lucide-lock', a.protectRange, { write: true }),
        item(__('Remove protection'), 'lucide-lock-open', a.unprotectRange, { write: true }),
        ...(a.cellHistory ? [item(__('Cell history'), 'lucide-history', a.cellHistory)] : []),
      ],
    },
    ...(a.askAi
      ? [
          {
            group: 'AI',
            hideLabel: true,
            options: [item(__('Ask AI…'), 'lucide-sparkles', a.askAi, { write: true })],
          },
        ]
      : []),
  ]

  return [
    // The editor's export / import menu, which already leaves Import out for viewers.
    { key: 'file', label: __('File'), options: a.fileOptions },
    { key: 'edit', label: __('Edit'), options: forViewers(edit, a.readOnly) },
    { key: 'view', label: __('View'), options: forViewers(view, a.readOnly) },
    { key: 'insert', label: __('Insert'), options: forViewers(insert, a.readOnly) },
    { key: 'format', label: __('Format'), options: forViewers(format, a.readOnly) },
    { key: 'data', label: __('Data'), options: forViewers(data, a.readOnly) },
  ].filter((m) => m.options.length > 0)
}
