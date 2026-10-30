import { describe, expect, it, vi } from 'vitest'

// @ts-expect-error — plain JS config factory, no type declarations.
import { buildMenuBar } from './menubar.config.js'

type Option = {
  label: string
  icon?: string
  onClick?: () => void
  submenu?: Entry[]
  disabled?: boolean
}
type Group = { group: string; options: Option[] }
type Entry = Option | Group
type Menu = { key: string; label: string; options: Entry[] }

/** A submenu the editor hands over ready-made (number formats, borders…). */
const handed = (name: string, fn: () => void) => [{ label: `${name} option`, onClick: fn }]

/** Every callback and handed-over menu the factory takes, as spies. */
function actions(overrides: Record<string, unknown> = {}) {
  const fns = Object.fromEntries(
    [
      'undo',
      'redo',
      'openFindReplace',
      'pasteSpecial',
      'clearContents',
      'deleteRows',
      'deleteCols',
      'moveColLeft',
      'moveColRight',
      'zoomIn',
      'zoomOut',
      'resetZoom',
      'freezeRows',
      'freezeCols',
      'unfreezeRows',
      'unfreezeCols',
      'hideRows',
      'hideCols',
      'unhideAllRows',
      'unhideAllCols',
      'toggleShowFormulas',
      'toggleNotes',
      'openShortcuts',
      'insertRowAbove',
      'insertRowBelow',
      'insertRows',
      'insertColLeft',
      'insertColRight',
      'insertCols',
      'insertChart',
      'insertPivot',
      'insertSlicer',
      'insertLink',
      'insertCheckbox',
      'insertDropdown',
      'insertNote',
      'numberFormat',
      'adjustDecimals',
      'toggleFormat',
      'toggleMerge',
      'autoFitRows',
      'autoFitCols',
      'openConditionalFormat',
      'toggleFormatPainter',
      'clearFormatting',
      'sortColumn',
      'toggleFilter',
      'openValidation',
      'openNamedRanges',
      'splitText',
      'smartFill',
      'protectRange',
      'unprotectRange',
      'cellHistory',
      'askAi',
      'file',
      'numberFormats',
      'currencies',
      'fonts',
      'align',
      'wrap',
      'borders',
    ].map((name) => [name, vi.fn()]),
  )
  return {
    fns,
    args: {
      ...fns,
      readOnly: false,
      canUndo: true,
      canRedo: true,
      canPaste: true,
      frozenRows: 1,
      frozenCols: 1,
      hasHiddenRows: true,
      hasHiddenCols: true,
      showFormulas: false,
      notesCount: 2,
      filterOn: false,
      fileOptions: [{ group: 'Export', options: handed('File', fns.file) }],
      numberFormatOptions: handed('Number', fns.numberFormats),
      currencyOptions: handed('Currency', fns.currencies),
      fontFamilyOptions: handed('Font', fns.fonts),
      alignOptions: handed('Align', fns.align),
      wrapOptions: handed('Wrap', fns.wrap),
      borderOptions: handed('Borders', fns.borders),
      ...overrides,
    },
  }
}

/** Every item in a menu, submenus included. */
function items(entries: Entry[]): Option[] {
  return entries.flatMap((e) => {
    if ('group' in e) return items(e.options)
    return [e, ...(e.submenu ? items(e.submenu) : [])]
  })
}
const labels = (menu: Menu) => items(menu.options).map((o) => o.label)
const menu = (menus: Menu[], label: string) => menus.find((m) => m.label === label)!
const keys = (menus: Menu[]) => menus.map((m) => m.key)

describe('buildMenuBar', () => {
  it('builds File, Edit, View, Insert, Format and Data, in that order', () => {
    const menus: Menu[] = buildMenuBar(actions().args)
    expect(menus.map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Insert', 'Format', 'Data'])
    expect(keys(menus)).toEqual(['file', 'edit', 'view', 'insert', 'format', 'data'])
  })

  it('reaches every action it is given, each labelled in words', () => {
    const { fns, args } = actions()
    const menus: Menu[] = buildMenuBar(args)
    for (const m of menus) {
      for (const option of items(m.options)) {
        expect(option.label).toMatch(/[A-Za-z]{2}/)
        option.onClick?.()
      }
    }
    const missed = Object.entries(fns)
      .filter(([, fn]) => fn.mock.calls.length === 0)
      .map(([name]) => name)
    expect(missed).toEqual([])
  })

  it('keeps what the old toolbar, its … menu and the right-click menu offered', () => {
    const all = buildMenuBar(actions().args).flatMap(labels)
    for (const label of [
      // toolbar and … More tools
      'Underline',
      'Strikethrough',
      'Font',
      'Thousands separator',
      'Wrapping',
      'Format painter',
      'Clear formatting',
      'Conditional formatting…',
      'Link…',
      'Merge cells',
      'Create a filter',
      'Smart Fill',
      'Borders',
      'Zoom in',
      'Pivot table…',
      'Chart…',
      'Named ranges…',
      'Ask AI…',
      'Keyboard shortcuts',
      'Notes (2)',
      // right-click menu
      'Row above',
      'Column right',
      'Delete rows',
      'Move column left',
      'Fit column width',
      'Hide rows',
      'Unhide all columns',
      'Freeze',
      'Unfreeze rows',
      'Paste special',
      'Data validation…',
      'Protect range',
      'Remove protection',
      'Split text to columns',
      'Slicer',
      'Cell history',
    ])
      expect(all).toContain(label)
  })

  it('groups the asked-for actions under their menus', () => {
    const menus: Menu[] = buildMenuBar(actions().args)
    expect(labels(menu(menus, 'File'))).toContain('File option')
    expect(labels(menu(menus, 'Edit'))).toEqual(
      expect.arrayContaining(['Undo', 'Redo', 'Find and replace', 'Clear contents']),
    )
    expect(labels(menu(menus, 'View'))).toEqual(
      expect.arrayContaining(['Zoom in', 'Zoom out', 'Freeze']),
    )
    expect(labels(menu(menus, 'Insert'))).toEqual(
      expect.arrayContaining([
        'Row above',
        'Column left',
        'Chart…',
        'Pivot table…',
        'Slicer',
        'Link…',
        'Checkbox',
        'Dropdown',
      ]),
    )
    expect(labels(menu(menus, 'Format'))).toEqual(
      expect.arrayContaining([
        'Number',
        'Font',
        'Alignment',
        'Wrapping',
        'Merge cells',
        'Borders',
        'Conditional formatting…',
        'Clear formatting',
      ]),
    )
    expect(labels(menu(menus, 'Data'))).toEqual(
      expect.arrayContaining([
        'Sort and filter this column',
        'Create a filter',
        'Data validation…',
        'Named ranges…',
        'Split text to columns',
        'Smart Fill',
        'Protect range',
      ]),
    )
  })

  it('leaves viewers only what reads the sheet', () => {
    const menus: Menu[] = buildMenuBar(actions({ readOnly: true }).args)
    expect(menus.map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Data'])
    expect(labels(menu(menus, 'Edit'))).toEqual(['Find and replace'])
    expect(labels(menu(menus, 'View'))).toEqual([
      'Zoom in',
      'Zoom out',
      'Reset zoom',
      'Show formulas',
      'Notes (2)',
      'Keyboard shortcuts',
    ])
    expect(labels(menu(menus, 'Data'))).toEqual(['Cell history'])
  })

  it('disables what cannot run yet and drops what is not there', () => {
    const menus: Menu[] = buildMenuBar(
      actions({
        canUndo: false,
        canPaste: false,
        frozenRows: 0,
        hasHiddenRows: false,
        askAi: null,
        cellHistory: null,
        filterOn: true,
      }).args,
    )
    const all = menus.flatMap((m) => items(m.options))
    const named = (label: string) => all.find((o) => o.label === label)
    expect(named('Undo')!.disabled).toBe(true)
    expect(named('Redo')!.disabled).toBe(false)
    expect(named('Paste special')!.disabled).toBe(true)
    expect(named('Unfreeze rows')!.disabled).toBe(true)
    expect(named('Unhide all rows')).toBeUndefined()
    expect(named('Ask AI…')).toBeUndefined()
    expect(named('Cell history')).toBeUndefined()
    expect(named('Remove filter')).toBeDefined()
  })
})
