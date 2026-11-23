import { Extension, type Editor } from '@tiptap/core'
import { Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { toggleHighlight } from '@/apps/writer/components/core-editor/formatting'

/**
 * Writer's keyboard shortcuts that the stock editor lacks or drops:
 * - Enter on a code block's third empty line, or ArrowDown at its end, leaves it.
 *   frappe-ui's code block (`extensions/code-block/code-block.ts`) replaces
 *   Tiptap's code block shortcuts, so these are forked from
 *   `@tiptap/extension-code-block`.
 * - Mod-Enter checks or unchecks the selected checklist items.
 * - Mod-Shift-h highlights the selection, or removes its highlight.
 * - Mod-Enter and Mod-k read the selection the browser shows, which the editor
 *   has not caught up with when the key follows a selection change at once.
 */
export const WriterKeyboard = Extension.create({
  name: 'writerKeyboard',
  // Ahead of the stock keymaps, which add a code line on Enter and a line break on
  // Mod-Enter, and of the link extension (priority 1000), which opens on Mod-k.
  priority: 1001,

  addKeyboardShortcuts() {
    return {
      Enter: () => exitCodeOnTripleEnter(this.editor),
      ArrowDown: () => exitCodeOnArrowDown(this.editor),
      Backspace: () => clearEmptyCodeBlock(this.editor),
      'Mod-Alt-c': () => this.editor.commands.toggleCodeBlock(),
      'Mod-Enter': () => {
        syncSelectionFromDOM(this.editor.view)
        return toggleTaskItems(this.editor)
      },
      'Mod-Shift-h': () => toggleHighlight(this.editor),
      'Mod-k': () => {
        syncSelectionFromDOM(this.editor.view)
        return false
      },
    }
  },
})

/** The empty selection at the end of a code block, or `null`. */
function codeBlockEnd(editor: Editor) {
  const { $from, empty } = editor.state.selection
  const isAtEnd = $from.parentOffset === $from.parent.content.size
  return empty && isAtEnd && $from.parent.type.name === 'codeBlock' ? $from : null
}

function exitCodeOnTripleEnter(editor: Editor): boolean {
  const $end = codeBlockEnd(editor)
  if (!$end?.parent.textContent.endsWith('\n\n')) return false
  return editor
    .chain()
    .command(({ tr }) => !!tr.delete($end.pos - 2, $end.pos))
    .exitCode()
    .scrollIntoView()
    .run()
}

function exitCodeOnArrowDown(editor: Editor): boolean {
  const $end = codeBlockEnd(editor)
  if (!$end) return false
  const after = $end.after()
  if (!editor.state.doc.nodeAt(after)) return editor.chain().exitCode().scrollIntoView().run()
  return editor.commands.command(({ tr }) => {
    tr.setSelection(Selection.near(tr.doc.resolve(after)))
    return true
  })
}

function clearEmptyCodeBlock(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection
  if (!empty || $from.parent.type.name !== 'codeBlock' || $from.parent.textContent) return false
  return editor.commands.clearNodes()
}

/** Checks every selected checklist item, or unchecks them when all are checked. */
function toggleTaskItems(editor: Editor): boolean {
  const { doc, selection } = editor.state
  const items: number[] = []
  doc.nodesBetween(selection.from, selection.to, (node, position, parent) => {
    if (node.isTextblock && parent?.type.name === 'taskItem') {
      items.push(doc.resolve(position).before())
    }
  })
  if (!items.length) return false
  const checked = items.some((position) => !doc.nodeAt(position)?.attrs.checked)
  return editor.commands.command(({ tr }) => {
    for (const position of items) tr.setNodeAttribute(position, 'checked', checked)
    return true
  })
}

/** Brings the editor's selection in line with the browser's before a shortcut reads it. */
export function syncSelectionFromDOM(view: EditorView): void {
  if (!(view.state.selection instanceof TextSelection)) return
  const { anchorNode, anchorOffset, focusNode, focusOffset } = document.getSelection() ?? {}
  if (!anchorNode || !focusNode) return
  if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) return
  const anchor = view.posAtDOM(anchorNode, anchorOffset ?? 0)
  const head = view.posAtDOM(focusNode, focusOffset ?? 0)
  const { selection, doc } = view.state
  if (anchor === selection.anchor && head === selection.head) return
  view.dispatch(
    view.state.tr.setSelection(TextSelection.between(doc.resolve(anchor), doc.resolve(head))),
  )
}
