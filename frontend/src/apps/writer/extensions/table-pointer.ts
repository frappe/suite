import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { cellAround, CellSelection, columnResizingPluginKey, isInTable } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Text-editor behaviour in table cells, ahead of frappe-ui's spreadsheet-style `TableNavigation`
 * (table-navigation.ts), which selects the whole cell on the first click and on Enter.
 *
 * - A plain click places the caret where it lands. A drag across cells still selects them
 *   (prosemirror-tables).
 * - Enter, Tab, Escape and the arrows reach the @, / and : menus, lists and cell-to-cell moves first,
 *   as they do outside a table. With nothing to handle them, Escape collapses a text selection and
 *   then selects the cell, and Tab selects the next cell.
 * - Delete at the end of the block above a table moves into the first cell.
 * - Selected cells are never dragged out, because a dropped cell becomes an extra cell in the row
 *   it lands in.
 */
export const TablePointer = Extension.create({
  name: 'tablePointer',
  priority: 300,

  addProseMirrorPlugins() {
    const { editor } = this
    const plugin: Plugin = new Plugin({
      key: new PluginKey('tablePointer'),
      props: {
        handleKeyDown(view, event) {
          if (!editor.isEditable) return false
          if (isPlainKey(event, 'Delete')) return enterTableAhead(view)
          if (!isCellKey(event) || !isEditingCell(view)) return false
          // The Table keymap runs before the list keymap and would take Tab to the next cell
          if (
            event.key === 'Tab' &&
            !isSuggestionOpen(view) &&
            indentListItem(editor, event.shiftKey)
          ) {
            return true
          }
          // Every later handler sees the key first, except TableNavigation's
          const later = view.state.plugins.slice(view.state.plugins.indexOf(plugin) + 1)
          for (const other of later) {
            if (isTableNavigation(other)) continue
            if (other.props.handleKeyDown?.call(other, view, event)) return true
          }
          if (event.key === 'Escape') return collapseSelection(view)
          return event.key === 'Enter'
        },
        handleDOMEvents: {
          pointerdown(view, event) {
            if (!editor.isEditable || !isPlainClick(event) || isOnResizeHandle(view)) return false
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
            if (pos === undefined || !cellAround(view.state.doc.resolve(pos))) return false
            // Selected cells would start a native drag of their content
            if (view.state.selection instanceof CellSelection) {
              const caret = TextSelection.near(view.state.doc.resolve(pos))
              view.dispatch(view.state.tr.setSelection(caret))
            }
            // Handled, so TableNavigation skips it; the default mousedown then places the caret
            return true
          },
          dragstart(view, event) {
            if (!(view.state.selection instanceof CellSelection)) return false
            event.preventDefault()
            return true
          },
        },
      },
    })
    return [plugin]
  },
})

/** TableNavigation's plugin has no key; it is the one that types into and pastes over selected cells */
function isTableNavigation(plugin: Plugin) {
  const { props } = plugin
  return !!(props.handleTextInput && props.handlePaste && props.handleDOMEvents?.compositionstart)
}

function isEditingCell(view: EditorView) {
  return isInTable(view.state) && !(view.state.selection instanceof CellSelection)
}

const CELL_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

/** Shift only counts for Tab; Shift+Enter and Shift+arrows already pass TableNavigation */
function isCellKey(event: KeyboardEvent) {
  if (!CELL_KEYS.has(event.key)) return false
  return isPlainKey(event, event.key) || (event.key === 'Tab' && isPlainKey(event, 'Tab', true))
}

function isPlainKey(event: KeyboardEvent, key: string, shift = false) {
  const hasModifier = event.shiftKey !== shift || event.ctrlKey || event.metaKey || event.altKey
  return event.key === key && !hasModifier && !event.isComposing
}

/** The @, / and : menus keep `{ active, query, range }` as plugin state */
function isSuggestionOpen(view: EditorView) {
  return view.state.plugins.some((plugin) => {
    const state: unknown = plugin.getState(view.state)
    return (
      !!state &&
      typeof state === 'object' &&
      'query' in state &&
      'range' in state &&
      'active' in state &&
      state.active === true
    )
  })
}

function indentListItem(editor: Editor, outdent: boolean) {
  const item = ['listItem', 'taskItem'].find((name) => editor.isActive(name))
  if (!item) return false
  return outdent ? editor.commands.liftListItem(item) : editor.commands.sinkListItem(item)
}

function collapseSelection(view: EditorView) {
  const { selection } = view.state
  if (selection.empty) return false
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, selection.head)))
  return true
}

function enterTableAhead(view: EditorView) {
  const { $head, empty } = view.state.selection
  if (!empty || !$head.parent.isTextblock || $head.parentOffset < $head.parent.content.size)
    return false
  const after = $head.after()
  if (view.state.doc.resolve(after).nodeAfter?.type.spec.tableRole !== 'table') return false
  const firstCell = Selection.findFrom(view.state.doc.resolve(after + 1), 1, true)
  if (!firstCell) return false
  view.dispatch(view.state.tr.setSelection(firstCell).scrollIntoView())
  return true
}

function isPlainClick(event: PointerEvent) {
  const hasModifier = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
  return event.pointerType !== 'touch' && event.button === 0 && !hasModifier
}

function isOnResizeHandle(view: EditorView) {
  const resizing = columnResizingPluginKey.getState(view.state)
  return !!resizing && resizing.activeHandle > -1
}
