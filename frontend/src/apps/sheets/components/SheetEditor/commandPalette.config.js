// Pure config factory for SheetEditor command palette groups.
// buildCommandGroups takes a map of action callbacks and returns the groups array
// consumed by the <CommandPalette> component.

function item(name, title, description, fn) {
  return { name, title, description, fn }
}

function buildFormatGroup({ toggleFmt, setAlign, setValign, adjustDecimals, toggleWrap, clearFormatting }) {
  return {
    title: 'Format',
    items: [
      item('bold',          'Bold',                    'Ctrl+B',       () => toggleFmt('bold')),
      item('italic',        'Italic',                  'Ctrl+I',       () => toggleFmt('italic')),
      item('underline',     'Underline',               'Ctrl+U',       () => toggleFmt('underline')),
      item('strikethrough', 'Strikethrough',           'Ctrl+Shift+X', () => toggleFmt('strikethrough')),
      item('wrap',          'Wrap text',               '',             () => toggleWrap()),
      item('clearFmt',      'Clear formatting',        '',             () => clearFormatting()),
      item('align-left',    'Align left',              '',             () => setAlign('left')),
      item('align-center',  'Align center',            '',             () => setAlign('center')),
      item('align-right',   'Align right',             '',             () => setAlign('right')),
      item('valign-top',    'Align top',               '',             () => setValign('top')),
      item('valign-middle', 'Align middle',            '',             () => setValign('middle')),
      item('valign-bottom', 'Align bottom',            '',             () => setValign('bottom')),
      item('dec-inc',       'Increase decimal places', '',             () => adjustDecimals(+1)),
      item('dec-dec',       'Decrease decimal places', '',             () => adjustDecimals(-1)),
    ],
  }
}

function buildEditGroup({ undo, redo, repeatLast, showFindReplace, openFindReplace, showFormulas, repopulateGrid, showShortcutsHelp }) {
  return {
    title: 'Edit',
    items: [
      item('undo',      'Undo',               'Ctrl+Z', () => undo()),
      item('redo',      'Redo',               'Ctrl+Y', () => redo()),
      item('repeat',    'Repeat last action', 'F4',     () => repeatLast()),
      item('find',      'Find & replace',     'Ctrl+F', () => { openFindReplace ? openFindReplace() : (showFindReplace.value = true) }),
      item('formulas',  'Show formulas',      'Ctrl+`', () => { showFormulas.value = !showFormulas.value; repopulateGrid() }),
      item('shortcuts', 'Keyboard shortcuts', '?',      () => { showShortcutsHelp.value = true }),
    ],
  }
}

function buildStructureGroup({
  contextMenu, getGrid,
  doInsertRow, doDeleteRow,
  doInsertCol, doDeleteCol,
  doMoveColLeft, doMoveColRight,
  doHideRows, doHideCols,
  doUnhideAllRows, doUnhideAllCols,
  doAutoFitCol, doAutoFitRow,
  toggleMerge, addRowsCount, doAddMoreRows,
}) {
  return {
    title: 'Structure',
    items: [
      item('row-above',  'Insert row above',      '', () => { contextMenu.targetRow = getGrid().getSelection().r0; doInsertRow(false) }),
      item('row-below',  'Insert row below',      '', () => { contextMenu.targetRow = getGrid().getSelection().r0; doInsertRow(true)  }),
      item('row-del',    'Delete row',            '', () => { contextMenu.targetRow = getGrid().getSelection().r0; doDeleteRow()      }),
      item('col-left',   'Insert column left',    '', () => { contextMenu.targetCol = getGrid().getSelection().c0; doInsertCol(false) }),
      item('col-right',  'Insert column right',   '', () => { contextMenu.targetCol = getGrid().getSelection().c0; doInsertCol(true)  }),
      item('col-del',    'Delete column',         '', () => { contextMenu.targetCol = getGrid().getSelection().c0; doDeleteCol()      }),
      item('col-move-l', 'Move column left',      '', () => { contextMenu.targetCol = getGrid().getSelection().c0; doMoveColLeft()  }),
      item('col-move-r', 'Move column right',     '', () => { contextMenu.targetCol = getGrid().getSelection().c0; doMoveColRight() }),
      item('row-hide',   'Hide row',              '', () => doHideRows()),
      item('col-hide',   'Hide column',           '', () => doHideCols()),
      item('row-unhide', 'Unhide all rows',       '', () => doUnhideAllRows()),
      item('col-unhide', 'Unhide all columns',    '', () => doUnhideAllCols()),
      item('autofit-w',  'Auto-fit column width', '', () => { contextMenu.targetCol = getGrid().getSelection().c0; doAutoFitCol() }),
      item('autofit-h',  'Auto-fit row height',   '', () => { contextMenu.targetRow = getGrid().getSelection().r0; doAutoFitRow() }),
      item('merge',      'Merge cells',           '', () => toggleMerge()),
      item('add-rows',   `Add ${addRowsCount.value} more rows`, '', () => doAddMoreRows()),
    ],
  }
}

function buildViewGroup({ contextMenu, getGrid, doFreezeRow, doFreezeCol, doUnfreezeRows, doUnfreezeCols, showSortFilter }) {
  return {
    title: 'View',
    items: [
      item('freeze-row',   'Freeze rows up to selection', '', () => { contextMenu.targetRow = getGrid().getSelection().r0; doFreezeRow()  }),
      item('freeze-col',   'Freeze cols up to selection', '', () => { contextMenu.targetCol = getGrid().getSelection().c0; doFreezeCol()  }),
      item('unfreeze-row', 'Unfreeze rows',               '', () => doUnfreezeRows()),
      item('unfreeze-col', 'Unfreeze columns',            '', () => doUnfreezeCols()),
      item('filter',       'Toggle filter',               '', () => { showSortFilter.value = !showSortFilter.value }),
    ],
  }
}

function buildInsertGroup({ openPivotDialog }) {
  return {
    title: 'Insert',
    items: [
      item('pivot-insert', 'Insert pivot table', '', () => openPivotDialog()),
    ],
  }
}

function buildSheetGroup({ addSheet, currentSheet, openRenameDialog, doDuplicateSheet, doDeleteSheet }) {
  return {
    title: 'Sheet',
    items: [
      item('sheet-add',       'Add sheet',       '', () => addSheet()),
      item('sheet-rename',    'Rename sheet',    '', () => openRenameDialog(currentSheet.value)),
      item('sheet-duplicate', 'Duplicate sheet', '', () => doDuplicateSheet(currentSheet.value)),
      item('sheet-delete',    'Delete sheet',    '', () => doDeleteSheet(currentSheet.value)),
    ],
  }
}

function buildFileGroup({ onSave, exportCSV, exportXLSX, exportPDF, csvInputRef, xlsxInputRef }) {
  return {
    title: 'File',
    items: [
      item('save',        'Save',        'Ctrl+S', () => onSave()),
      item('csv-export',  'Export CSV',  '',       () => exportCSV()),
      item('xlsx-export', 'Export XLSX', '',       () => exportXLSX()),
      item('pdf-export',  'Export PDF',  '',       () => exportPDF()),
      item('csv-import',  'Import CSV',  '',       () => csvInputRef.value?.click()),
      item('xlsx-import', 'Import XLSX', '',       () => xlsxInputRef.value?.click()),
    ],
  }
}

/**
 * buildCommandGroups — factory that wires action callbacks into the
 * command-palette groups array.
 *
 * @param {object} actions — flat map of every callback / ref used across groups
 * @returns {Array} command palette groups
 */
export function buildCommandGroups(actions) {
  return [
    buildFormatGroup(actions),
    buildEditGroup(actions),
    buildStructureGroup(actions),
    buildViewGroup(actions),
    buildInsertGroup(actions),
    buildSheetGroup(actions),
    buildFileGroup(actions),
  ]
}
