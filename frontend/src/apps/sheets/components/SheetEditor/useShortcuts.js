import { useKeyboardShortcut } from 'frappe-ui'

/**
 * Keyboard shortcut dispatch for SheetEditor.
 *
 * App-level shortcuts are registered through frappe-ui's `useShortcut` registry
 * so they are the single source of truth for the `<KeyboardShortcutsModal>` — the
 * shortcut description lives next to its handler, so the help dialog can never
 * drift. Grid navigation/edit shortcuts stay in the canvas (they need the canvas
 * element + edit-mode state); they're registered here as *display-only* entries
 * (no handler, `preventDefault: false`) purely so the modal lists them too.
 *
 * A small residual `onGlobalKey` handles the shortcuts frappe-ui's `e.key`
 * matcher cannot: the context-sensitive Escape cascade, and the `e.code`-based
 * combos (macOS rewrites Alt+= → ≠ and Shift+<digit> → a symbol).
 *
 * @param {{
 *   formulaInputEl: () => HTMLElement | null,
 *   undo: () => void, redo: () => void, onSave: () => void,
 *   toggleFmt: (fmt: string) => void, repeatLast: () => void,
 *   toggleShowFormulas: () => void,
 *   showFindReplace: import('vue').Ref<boolean>,
 *   openVersionHistory: () => void, openHyperlinkDialog: () => void,
 *   openCommentPanel: () => void, openQuickFilterForActive: () => void,
 *   zoomBy: (d: number) => void, resetZoom: () => void,
 *   commentPanel: { open: boolean },
 *   dropdownPanel: { open: boolean },
 *   splitText: { open: boolean },
 *   revertSplitPreview: () => void, closeSplit: () => void,
 *   clipboard: { hasData: () => boolean, clear: () => void },
 *   clipboardHas: import('vue').Ref<boolean>,
 *   setMarchingAnts: (v: null) => void,
 *   fillDown: () => void, fillRight: () => void,
 *   runSmartFill: () => void,
 *   insertRowsCols: () => void, deleteRowsCols: () => void,
 *   applyNumberFormat: (fmt: string) => void, pasteValues: () => void,
 *   readOnly?: () => boolean,
 * }} actions
 */

// Ctrl/Cmd+Shift+<digit> → number-format key, matching Google Sheets' 1-6 row.
// Keyed by KeyboardEvent.code so shifted digits ('!', '@', …) still resolve.
// Exponent/scientific (GS's Ctrl+Shift+6) is intentionally absent — the format
// engine has no scientific renderer yet, so there's nothing correct to apply.
const NUMBER_FORMAT_KEYS = {
  Digit1: 'number',
  Digit2: 'time',
  Digit3: 'date',
  Digit4: 'currency:USD:2',
  Digit5: 'percentage',
}

export function useShortcuts(actions) {
  const {
    formulaInputEl, undo, redo, onSave, toggleFmt, repeatLast,
    toggleShowFormulas, showFindReplace, openFindReplace,
    openVersionHistory, openHyperlinkDialog, openCommentPanel, openQuickFilterForActive,
    zoomBy, resetZoom,
    commentPanel, dropdownPanel, splitText, revertSplitPreview, closeSplit,
    clipboard, clipboardHas, setMarchingAnts,
    fillDown, fillRight,
    runSmartFill,
    insertRowsCols, deleteRowsCols, applyNumberFormat, pasteValues,
    // Optional getter — true for a view-only viewer (guest / read-only share).
    // Mutating shortcuts carry `enabled: notReadOnly` so they're both inert
    // AND hidden from the modal while read-only; pure view shortcuts stay live.
    readOnly = () => false,
  } = actions

  const notReadOnly = () => !readOnly()

  function _isInInput() {
    const ae = document.activeElement
    return ae?.tagName === 'INPUT' && ae !== formulaInputEl?.()
  }

  // ── Registry (source of truth for the modal) ─────────────────────────────────
  // Shortcuts frappe-ui can match on `e.key`, registered with handler + label.
  useKeyboardShortcut([
    // View / tools — available even in read-only.
    { combo: 'Mod+S',  description: 'Save',            group: 'View', handler: onSave },
    {
      combo: 'Mod+F',
      description: 'Find & replace',
      group: 'View',
      allowInInput: true,
      handler: () => {
        document.activeElement?.blur?.()
        if (openFindReplace) openFindReplace()
        else if (showFindReplace) showFindReplace.value = true
      },
    },
    { combo: 'Mod+Backtick', description: 'Show formulas', group: 'View', handler: toggleShowFormulas },
    { combo: 'Mod+Equal', description: 'Zoom in', group: 'View', handler: () => zoomBy(+0.1) },
    { combo: 'Mod+Shift+Equal', description: 'Zoom in', group: 'View', handler: () => zoomBy(+0.1) },
    { combo: 'Mod+Minus', description: 'Zoom out', group: 'View', handler: () => zoomBy(-0.1) },
    { combo: 'Mod+Digit0',  description: 'Reset zoom',      group: 'View', handler: resetZoom },

    // Editing — mutating, so hidden + inert while read-only.
    { combo: 'Mod+Z', description: 'Undo',                    group: 'Editing', enabled: notReadOnly, handler: undo },
    { combo: 'Mod+Shift+Z', description: 'Redo',                    group: 'Editing', enabled: notReadOnly, handler: redo },
    { combo: 'Mod+Y', description: 'Redo',                    group: 'Editing', enabled: notReadOnly, handler: redo },
    { combo: 'F4',                         description: 'Repeat last action',      group: 'Editing', enabled: notReadOnly, handler: repeatLast },
    { combo: 'Mod+D', description: 'Fill down',               group: 'Editing', enabled: notReadOnly, handler: fillDown },
    { combo: 'Mod+R', description: 'Fill right',              group: 'Editing', enabled: notReadOnly, handler: fillRight },
    { combo: 'Mod+E', description: 'Smart Fill from examples', group: 'Editing', enabled: notReadOnly, handler: () => runSmartFill?.() },
    { combo: 'Mod+Shift+V', description: 'Paste values only',       group: 'Editing', enabled: notReadOnly, handler: () => pasteValues?.() },
    { combo: 'Mod+L', description: 'Insert hyperlink',        group: 'Editing', enabled: notReadOnly, handler: openHyperlinkDialog },
    { combo: 'Shift+F2', description: 'Add / edit comment',      group: 'Editing', enabled: notReadOnly, handler: openCommentPanel },
    { combo: 'Alt+ArrowDown', description: 'Quick filter on column',  group: 'Editing', enabled: notReadOnly, handler: openQuickFilterForActive },
    { combo: 'Mod+Alt+Shift+H', description: 'Version history', group: 'Editing', enabled: notReadOnly, handler: openVersionHistory },

    // Formatting — mutating.
    { combo: 'Mod+B', description: 'Bold',          group: 'Formatting', enabled: notReadOnly, handler: () => toggleFmt('bold') },
    { combo: 'Mod+I', description: 'Italic',        group: 'Formatting', enabled: notReadOnly, handler: () => toggleFmt('italic') },
    { combo: 'Mod+U', description: 'Underline',     group: 'Formatting', enabled: notReadOnly, handler: () => toggleFmt('underline') },
    { combo: 'Mod+Shift+X', description: 'Strikethrough', group: 'Formatting', enabled: notReadOnly, handler: () => toggleFmt('strikethrough') },
  ])

  // ── Display-only entries ─────────────────────────────────────────────────────
  // Real handlers live in the grid canvas, the native clipboard events, or the
  // residual onGlobalKey below. `preventDefault: false` + no handler keeps them
  // passive — they never intercept a keystroke, they just populate the modal.
  useKeyboardShortcut([
    // Navigation (grid canvas)
    { combo: 'ArrowUp',    description: 'Move selection', group: 'Navigation', preventDefault: false },
    { combo: 'ArrowDown',  description: 'Move selection', group: 'Navigation', preventDefault: false },
    { combo: 'ArrowLeft',  description: 'Move selection', group: 'Navigation', preventDefault: false },
    { combo: 'ArrowRight', description: 'Move selection', group: 'Navigation', preventDefault: false },
    { combo: 'Shift+ArrowRight', description: 'Extend selection',       group: 'Navigation', preventDefault: false },
    { combo: 'Mod+ArrowLeft',  description: 'Jump to data-region edge', group: 'Navigation', preventDefault: false },
    { combo: 'Mod+Home',       description: 'Jump to start / end',    group: 'Navigation', preventDefault: false },
    { combo: 'Mod+End',        description: 'Jump to start / end',    group: 'Navigation', preventDefault: false },
    { combo: 'PageDown',   description: 'Scroll one screen', group: 'Navigation', preventDefault: false },
    { combo: 'PageUp',     description: 'Scroll one screen', group: 'Navigation', preventDefault: false },

    // Selection (grid canvas)
    { combo: 'Shift+Space', description: 'Select row',          group: 'Selection', preventDefault: false },
    { combo: 'Mod+Space', description: 'Select column',       group: 'Selection', preventDefault: false },
    { combo: 'Mod+A', description: 'Select data / all',   group: 'Selection', preventDefault: false },
    { combo: 'Mod+Shift+Space', description: 'Select entire sheet', group: 'Selection', preventDefault: false },

    // Editing (grid canvas / native clipboard / residual handler)
    { combo: 'F2',                         description: 'Edit cell',            group: 'Editing', preventDefault: false },
    { combo: 'Delete',                     description: 'Clear cell',           group: 'Editing', preventDefault: false },
    { combo: 'Backspace',                  description: 'Clear cell',           group: 'Editing', preventDefault: false },
    { combo: 'Enter',                      description: 'Commit + move down',   group: 'Editing', preventDefault: false },
    { combo: 'Tab',                        description: 'Commit + move right',  group: 'Editing', preventDefault: false },
    { combo: 'Alt+Enter', description: 'New line in cell',     group: 'Editing', enabled: notReadOnly, preventDefault: false },
    { combo: 'Mod+C', description: 'Copy',                 group: 'Editing', preventDefault: false },
    { combo: 'Mod+X', description: 'Cut',                  group: 'Editing', enabled: notReadOnly, preventDefault: false },
    { combo: 'Mod+V', description: 'Paste',                group: 'Editing', enabled: notReadOnly, preventDefault: false },
    { combo: 'Mod+Alt+Equal', description: 'Insert rows / columns', group: 'Editing', enabled: notReadOnly, preventDefault: false },
    { combo: 'Mod+Alt+Minus', description: 'Delete rows / columns', group: 'Editing', enabled: notReadOnly, preventDefault: false },

    // Number formats (Ctrl+Shift+1..5) — handled via e.code below; here for display.
    { combo: 'Mod+Shift+Digit1', description: 'Format as number',   group: 'Formatting', enabled: notReadOnly, preventDefault: false },
    { combo: 'Mod+Shift+Digit2', description: 'Format as time',     group: 'Formatting', enabled: notReadOnly, preventDefault: false },
    { combo: 'Mod+Shift+Digit3', description: 'Format as date',     group: 'Formatting', enabled: notReadOnly, preventDefault: false },
    { combo: 'Mod+Shift+Digit4', description: 'Format as currency', group: 'Formatting', enabled: notReadOnly, preventDefault: false },
    { combo: 'Mod+Shift+Digit5', description: 'Format as percent',  group: 'Formatting', enabled: notReadOnly, preventDefault: false },
  ])

  // ── Residual handler (window keydown) ────────────────────────────────────────
  // Everything frappe-ui's e.key matcher can't do: the Escape cascade and the
  // e.code-based combos.
  function onGlobalKey(e) {
    const inInput = _isInInput()

    // Escape — context-sensitive close (first match wins). Kept custom because
    // it's a cascade, not a single action; while editing a cell the canvas owns
    // Escape (cancel edit) and focus is in the editor, so inInput short-circuits.
    if (e.key === 'Escape' && !inInput) {
      if (commentPanel.open)   { commentPanel.open  = false; return }
      if (dropdownPanel.open)  { dropdownPanel.open = false; return }
      if (splitText.open)      { revertSplitPreview(); closeSplit(); return }
      if (clipboard.hasData()) { clipboard.clear(); clipboardHas.value = false; setMarchingAnts(null); return }
      return
    }

    if (readOnly() || inInput) return
    const mod = e.metaKey || e.ctrlKey

    // Mod+Alt+= / Mod+Alt+-  — insert / delete rows or columns. Match on e.code:
    // with Alt held, macOS rewrites e.key ('=' → '≠', '-' → '–').
    if (mod && e.altKey && e.code === 'Equal') { e.preventDefault(); insertRowsCols?.(); return }
    if (mod && e.altKey && e.code === 'Minus') { e.preventDefault(); deleteRowsCols?.(); return }
    // Mod+Shift+1..5 — number formats. Match on e.code so shifted digits resolve.
    if (mod && e.shiftKey && NUMBER_FORMAT_KEYS[e.code]) {
      e.preventDefault(); applyNumberFormat?.(NUMBER_FORMAT_KEYS[e.code]); return
    }
  }

  return { onGlobalKey }
}
