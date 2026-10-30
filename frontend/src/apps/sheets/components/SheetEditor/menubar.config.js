// The menu bar's six menus (File, Edit, View, Insert, Format, Data). Every
// action the toolbar, the right-click menu or a shortcut offers is listed here
// by name, so the toolbar can stay short. `a` holds the editor's callbacks and
// state; the factory only arranges them.

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
        item('Undo', 'lucide-undo-2', a.undo, { write: true, disabled: !a.canUndo }),
        item('Redo', 'lucide-redo-2', a.redo, { write: true, disabled: !a.canRedo }),
      ],
    },
    {
      group: 'Cells',
      hideLabel: true,
      options: [
        item('Find and replace', 'lucide-text-search', a.openFindReplace),
        submenu(
          'Paste special',
          'lucide-clipboard',
          [
            item('Values only', 'lucide-clipboard', () => a.pasteSpecial('values')),
            item('Formats only', 'lucide-clipboard', () => a.pasteSpecial('formats')),
            item('Formulas only', 'lucide-clipboard', () => a.pasteSpecial('formulas')),
          ],
          { write: true, disabled: !a.canPaste },
        ),
        item('Clear contents', 'lucide-eraser', a.clearContents, { write: true }),
      ],
    },
    {
      group: 'Rows and columns',
      hideLabel: true,
      options: [
        item('Delete rows', 'lucide-trash-2', a.deleteRows, { write: true }),
        item('Delete columns', 'lucide-trash-2', a.deleteCols, { write: true }),
        item('Move column left', 'lucide-chevron-left', a.moveColLeft, { write: true }),
        item('Move column right', 'lucide-chevron-right', a.moveColRight, { write: true }),
      ],
    },
  ]

  const view = [
    {
      group: 'Zoom',
      hideLabel: true,
      options: [
        item('Zoom in', 'lucide-zoom-in', a.zoomIn),
        item('Zoom out', 'lucide-zoom-out', a.zoomOut),
        item('Reset zoom', 'lucide-search', a.resetZoom),
      ],
    },
    {
      group: 'Freeze',
      hideLabel: true,
      options: [
        submenu(
          'Freeze',
          'lucide-snowflake',
          [
            item('Rows up to the current row', 'lucide-snowflake', a.freezeRows),
            item('Columns up to the current column', 'lucide-snowflake', a.freezeCols),
            item('Unfreeze rows', 'lucide-x', a.unfreezeRows, { disabled: !a.frozenRows }),
            item('Unfreeze columns', 'lucide-x', a.unfreezeCols, { disabled: !a.frozenCols }),
          ],
          { write: true },
        ),
        item('Hide rows', 'lucide-eye-off', a.hideRows, { write: true }),
        item('Hide columns', 'lucide-eye-off', a.hideCols, { write: true }),
        ...(a.hasHiddenRows
          ? [item('Unhide all rows', 'lucide-eye', a.unhideAllRows, { write: true })]
          : []),
        ...(a.hasHiddenCols
          ? [item('Unhide all columns', 'lucide-eye', a.unhideAllCols, { write: true })]
          : []),
      ],
    },
    {
      group: 'Show',
      hideLabel: true,
      options: [
        item(
          a.showFormulas ? 'Show values' : 'Show formulas',
          'lucide-sigma',
          a.toggleShowFormulas,
        ),
        item(
          a.notesCount ? `Notes (${a.notesCount})` : 'Notes',
          'lucide-sticky-note',
          a.toggleNotes,
        ),
        item('Keyboard shortcuts', 'lucide-keyboard', a.openShortcuts),
      ],
    },
  ]

  const insert = [
    {
      group: 'Rows and columns',
      hideLabel: true,
      options: [
        item('Row above', 'lucide-arrow-up', a.insertRowAbove),
        item('Row below', 'lucide-arrow-down', a.insertRowBelow),
        item('Rows…', 'lucide-plus', a.insertRows),
        item('Column left', 'lucide-arrow-left', a.insertColLeft),
        item('Column right', 'lucide-arrow-right', a.insertColRight),
        item('Columns…', 'lucide-plus', a.insertCols),
      ].map((o) => ({ ...o, write: true })),
    },
    {
      group: 'Objects',
      hideLabel: true,
      options: [
        item('Chart…', 'lucide-chart-bar', a.insertChart),
        item('Pivot table…', 'lucide-table-2', a.insertPivot),
        item('Slicer', 'lucide-list-filter', a.insertSlicer),
      ].map((o) => ({ ...o, write: true })),
    },
    {
      group: 'Cells',
      hideLabel: true,
      options: [
        item('Link…', 'lucide-link', a.insertLink, { write: true }),
        item('Checkbox', 'lucide-square-check', a.insertCheckbox, { write: true }),
        item('Dropdown', 'lucide-chevron-down', a.insertDropdown, { write: true }),
        item('Note', 'lucide-sticky-note', a.insertNote, { write: true }),
      ],
    },
  ]

  const format = [
    {
      group: 'Number',
      hideLabel: true,
      options: [
        submenu('Number', 'lucide-hash', a.numberFormatOptions),
        submenu('Currency', 'lucide-dollar-sign', a.currencyOptions),
        item('Percent', 'lucide-percent', () => a.numberFormat('percentage')),
        item('Thousands separator', 'lucide-hash', () => a.numberFormat('number')),
        item('Fewer decimal places', 'lucide-decimals-arrow-left', () => a.adjustDecimals(-1)),
        item('More decimal places', 'lucide-decimals-arrow-right', () => a.adjustDecimals(+1)),
      ],
    },
    {
      group: 'Text',
      hideLabel: true,
      options: [
        item('Bold', 'lucide-bold', () => a.toggleFormat('bold')),
        item('Italic', 'lucide-italic', () => a.toggleFormat('italic')),
        item('Underline', 'lucide-underline', () => a.toggleFormat('underline')),
        item('Strikethrough', 'lucide-strikethrough', () => a.toggleFormat('strikethrough')),
        submenu('Font', 'lucide-type', a.fontFamilyOptions),
      ],
    },
    {
      group: 'Layout',
      hideLabel: true,
      options: [
        submenu('Alignment', 'lucide-align-left', a.alignOptions),
        submenu('Wrapping', 'lucide-wrap-text', a.wrapOptions),
        item('Merge cells', 'lucide-table-cells-merge', a.toggleMerge),
        submenu('Borders', 'lucide-grid-2x2', a.borderOptions),
        item('Fit row height', 'lucide-move-vertical', a.autoFitRows),
        item('Fit column width', 'lucide-move-horizontal', a.autoFitCols),
      ],
    },
    {
      group: 'Rules',
      hideLabel: true,
      options: [
        item('Conditional formatting…', 'lucide-blend', a.openConditionalFormat),
        item('Format painter', 'lucide-paint-roller', a.toggleFormatPainter),
        item('Clear formatting', 'lucide-remove-formatting', a.clearFormatting),
      ],
    },
  ].map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, write: true })) }))

  const data = [
    {
      group: 'Sort and filter',
      hideLabel: true,
      options: [
        item('Sort and filter this column', 'lucide-arrow-down-wide-narrow', a.sortColumn, {
          write: true,
        }),
        item(a.filterOn ? 'Remove filter' : 'Create a filter', 'lucide-funnel', a.toggleFilter, {
          write: true,
        }),
      ],
    },
    {
      group: 'Cells',
      hideLabel: true,
      options: [
        item('Data validation…', 'lucide-list-checks', a.openValidation, { write: true }),
        item('Named ranges…', 'lucide-bookmark', a.openNamedRanges),
        item('Split text to columns', 'lucide-columns-2', a.splitText, { write: true }),
        item('Smart Fill', 'lucide-zap', a.smartFill, { write: true }),
      ],
    },
    {
      group: 'Protect',
      hideLabel: true,
      options: [
        item('Protect range', 'lucide-lock', a.protectRange, { write: true }),
        item('Remove protection', 'lucide-lock-open', a.unprotectRange, { write: true }),
        ...(a.cellHistory ? [item('Cell history', 'lucide-history', a.cellHistory)] : []),
      ],
    },
    ...(a.askAi
      ? [
          {
            group: 'AI',
            hideLabel: true,
            options: [item('Ask AI…', 'lucide-sparkles', a.askAi, { write: true })],
          },
        ]
      : []),
  ]

  return [
    // The editor's export / import menu, which already leaves Import out for viewers.
    { label: 'File', options: a.fileOptions },
    { label: 'Edit', options: forViewers(edit, a.readOnly) },
    { label: 'View', options: forViewers(view, a.readOnly) },
    { label: 'Insert', options: forViewers(insert, a.readOnly) },
    { label: 'Format', options: forViewers(format, a.readOnly) },
    { label: 'Data', options: forViewers(data, a.readOnly) },
  ].filter((m) => m.options.length > 0)
}
