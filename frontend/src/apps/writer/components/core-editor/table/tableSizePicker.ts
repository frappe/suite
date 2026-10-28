import type { Editor } from '@tiptap/core'
import { createApp, type App } from 'vue'

import { boxOf, type Box } from './selectionRing'
import TableSizePicker from './TableSizePicker.vue'

let open: { app: App; host: HTMLElement } | null = null

/**
 * Opens the grid that sizes a new table, under `anchor` or else under the caret. The table gets a
 * header row.
 */
export function openTableSizePicker(editor: Editor, anchor?: Element) {
  closeTableSizePicker()
  const box = anchor ? boxOf(anchor.getBoundingClientRect()) : caretBox(editor)
  mount(editor, box)
}

function mount(editor: Editor, anchor: Box) {
  const host = document.body.appendChild(document.createElement('div'))
  const app = createApp(TableSizePicker, {
    anchor,
    onPick: ({ rows, columns }: { rows: number; columns: number }) => {
      closeTableSizePicker()
      editor.chain().focus().insertTable({ rows, cols: columns, withHeaderRow: true }).run()
    },
    onClose: () => {
      closeTableSizePicker()
      editor.commands.focus()
    },
  })
  app.mount(host)
  open = { app, host }
}

export function closeTableSizePicker() {
  open?.app.unmount()
  open?.host.remove()
  open = null
}

function caretBox(editor: Editor): Box {
  const caret = editor.view.coordsAtPos(editor.state.selection.from)
  return { left: caret.left, top: caret.top, width: 0, height: caret.bottom - caret.top }
}
