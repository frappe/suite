<template>
  <div
    ref="layer"
    class="pointer-events-none absolute left-0 top-0 z-[5]"
    @pointerdown.capture="rememberCaret"
  >
    <template v-if="target && boxes">
      <template v-if="boxes.row && target.kind !== 'column'">
        <Dropdown v-model:open="open.row" :options="rowOptions" :offset="4">
          <template #trigger>
            <span class="writer-table-anchor" :style="place(rowGrip)" />
          </template>
        </Dropdown>
        <TableGrip
          axis="row"
          :open="open.row || drag.dragging.value === 'row'"
          :label="__('Row options')"
          :style="place(rowGrip)"
          v-on="drag.handlers('row')"
          @keydown.enter.prevent="open.row = true"
        />
      </template>

      <template v-if="boxes.column && target.kind !== 'row'">
        <Dropdown v-model:open="open.column" :options="columnOptions" :offset="4">
          <template #trigger>
            <span class="writer-table-anchor" :style="place(columnGrip)" />
          </template>
        </Dropdown>
        <TableGrip
          axis="column"
          :open="open.column || drag.dragging.value === 'column'"
          :label="__('Column options')"
          :style="place(columnGrip)"
          v-on="drag.handlers('column')"
          @keydown.enter.prevent="open.column = true"
        />
      </template>

      <template v-if="boxes.selection && target.kind === 'cells'">
        <Dropdown v-model:open="open.cell" :options="cellOptions" side="right" :offset="4">
          <template #trigger>
            <span class="writer-table-anchor" :style="place(cellGrip)" />
          </template>
        </Dropdown>
        <TableGrip
          axis="cell"
          :open="open.cell"
          :label="__('Cell options')"
          :style="place(cellGrip)"
          @click="open.cell = true"
        />
      </template>

      <div
        v-if="drag.dropLine.value"
        class="writer-table-drop"
        :style="place(drag.dropLine.value)"
        aria-hidden="true"
      />

      <template v-if="!drag.dragging.value && !isMenuOpen()">
        <Tooltip :text="__('Add column')" side="right">
          <button
            type="button"
            class="writer-table-add"
            :style="place(addColumnStrip)"
            :aria-label="__('Add column')"
            @click="addLine('column')"
          >
            <span class="lucide-plus size-3" aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip :text="__('Add row')" side="bottom">
          <button
            type="button"
            class="writer-table-add"
            :style="place(addRowStrip)"
            :aria-label="__('Add row')"
            @click="addLine('row')"
          >
            <span class="lucide-plus size-3" aria-hidden="true" />
          </button>
        </Tooltip>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type SelectionBookmark } from '@tiptap/pm/state'
import { cellAround, CellSelection } from '@tiptap/pm/tables'
import { useEventListener } from '@vueuse/core'
import { Dropdown, Tooltip } from 'frappe-ui'
import { computed, nextTick, reactive, toRef, useTemplateRef, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

import type { Box } from './selectionRing'
import { TableEditing } from './tableEditing'
import TableGrip from './TableGrip.vue'
import { cellMenu, columnMenu, rowMenu } from './tableMenus'
import type { Axis } from './tableShape'
import { useLineDrag } from './useLineDrag'
import { useTableTarget } from './useTableTarget'

const props = defineProps<{ editor: Editor }>()

const editor = toRef(props, 'editor')
const layer = useTemplateRef<HTMLElement>('layer')
const open = reactive({ row: false, column: false, cell: false })
const isMenuOpen = () => open.row || open.column || open.cell

const { target, boxes, wrapper, refresh } = useTableTarget(
  editor,
  layer,
  () => isMenuOpen() || drag.isPressed(),
)
const drag = useLineDrag({
  editor,
  target,
  wrapper,
  layer,
  onClick: (axis) => (open[axis] = true),
})

// A closed menu hands the controls back to the pointer
watch(isMenuOpen, (isOpen) => {
  if (isOpen) return
  refresh()
  const cell = target.value?.cell
  // Escape hands focus back to the menu's anchor, which cannot hold it, so typing would be lost
  setTimeout(() => {
    const remembered = caret
    caret = null
    if (cell === undefined || !isFocusLost()) return
    // A menu action changed the document and placed the selection itself
    if (remembered && remembered.doc !== props.editor.state.doc) {
      return props.editor.commands.focus(undefined, { scrollIntoView: false })
    }
    const bookmark = remembered?.bookmark
    if (!bookmark) return new TableEditing(props.editor, cell).focusCell()
    props.editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .command(({ tr }) => !!tr.setSelection(bookmark.resolve(tr.doc)))
      .run()
  })
})

/** The caret before a grip or a right-click took the selection, given back when its menu closes with Escape */
let caret: { bookmark: SelectionBookmark | null; doc: PMNode } | null = null
function rememberCaret() {
  const { selection, doc } = props.editor.state
  caret = { bookmark: selection instanceof TextSelection ? selection.getBookmark() : null, doc }
}

function isFocusLost() {
  const active = document.activeElement
  return !active || active === document.body || !!layer.value?.contains(active)
}

const GRIP = { long: 20, short: 10, cell: 18 }

const rowGrip = computed(() => {
  const { table, row } = boxes.value ?? {}
  if (!table || !row) return null
  const top = row.top + row.height / 2 - GRIP.long / 2
  return { left: table.left - GRIP.short / 2, top, width: GRIP.short, height: GRIP.long }
})

const columnGrip = computed(() => {
  const { table, column } = boxes.value ?? {}
  if (!table || !column) return null
  const left = column.left + column.width / 2 - GRIP.long / 2
  return { left, top: table.top - GRIP.short / 2, width: GRIP.long, height: GRIP.short }
})

const cellGrip = computed(() => {
  const selection = boxes.value?.selection
  if (!selection) return null
  const left = selection.left + selection.width - GRIP.cell - 5
  return { left, top: selection.top + 5, width: GRIP.cell, height: GRIP.cell }
})

const addColumnStrip = computed(() => {
  const { table, windowRight } = boxes.value ?? {}
  if (!table || windowRight === undefined) return null
  // A table wider than the page keeps the strip in the window, over its last column's edge
  const left = Math.min(table.left + table.width + 8, windowRight - 20)
  return { left, top: table.top, width: 16, height: table.height }
})

const addRowStrip = computed(() => {
  const table = boxes.value?.table
  return (
    table && { left: table.left, top: table.top + table.height + 8, width: table.width, height: 16 }
  )
})

const menuContext = () => {
  const current = target.value
  if (!current) return null
  const table = new TableEditing(props.editor, current.cell)
  return { table, target: current, editorElement: props.editor.view.dom }
}

const rowOptions = computed(() => {
  const context = menuContext()
  return context ? rowMenu(context) : []
})
const columnOptions = computed(() => {
  const context = menuContext()
  return context ? columnMenu(context) : []
})
const cellOptions = computed(() => {
  const context = menuContext()
  return context ? cellMenu(context) : []
})

function addLine(axis: Axis) {
  const current = target.value
  if (current) new TableEditing(props.editor, current.cell).addLineAtEnd(axis)
}

function place(box: Box | null | undefined) {
  if (!box) return { display: 'none' }
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
}

// A right-click on a cell selects it, unless it is already selected, and opens the cell menu
useEventListener(document, 'contextmenu', async (event: MouseEvent) => {
  const instance = props.editor
  const cell = event.target instanceof Element ? event.target.closest('td, th') : null
  if (!instance.isEditable || !cell || !instance.view.dom.contains(cell)) return
  const $cell = cellAround(instance.state.doc.resolve(instance.view.posAtDOM(cell, 0)))
  if (!$cell) return
  event.preventDefault()
  rememberCaret()
  const { selection } = instance.state
  let isSelected = false
  if (selection instanceof CellSelection) {
    selection.forEachCell((_node, pos) => (isSelected ||= pos === $cell.pos))
  }
  if (!isSelected) {
    instance.view.dispatch(
      instance.state.tr.setSelection(CellSelection.create(instance.state.doc, $cell.pos)),
    )
  }
  // The controls follow the selection on a microtask, then render
  await Promise.resolve()
  await nextTick()
  if (target.value?.kind === 'cells') open.cell = true
})
</script>
