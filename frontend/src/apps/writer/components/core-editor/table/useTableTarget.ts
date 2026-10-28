import type { Editor } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'
import { cellAround, CellSelection } from '@tiptap/pm/tables'
import { useEventListener } from '@vueuse/core'
import { ref, shallowRef, watch, type Ref } from 'vue'

import { boxOf, fitSelectionBox, unionBox, type Box } from './selectionRing'
import { TableShape } from './tableShape'

/** What the selection is: the caret's cell, a run of cells, a row or a column */
export type SelectionKind = 'caret' | 'cells' | 'row' | 'column'

export interface TableTarget {
  /** The position of the cell the handles sit on */
  cell: number
  row: number
  column: number
  kind: SelectionKind | null
  /** How many cells the selection holds */
  cellCount: number
  isMerged: boolean
  hasHeaderRow: boolean
}

/** Where the controls draw, in the layer's coordinates */
export interface TableBoxes {
  table: Box
  row: Box | null
  /** The part of the column inside the table's frame; null when too little of it shows */
  column: Box | null
  /** The selected cells, for a run of cells */
  selection: Box | null
  /** The right edge of the window */
  windowRight: number
}

/** The narrowest visible part of a column that still gets a grip */
const MIN_COLUMN_SHOWN = 24

/** How far past the table the pointer may roam before the hovered cell lets go */
const REACH = { before: 12, after: 32 }

/**
 * The table cell the controls follow, and where to draw them: the cell under the pointer, or the
 * selection's when it holds more than one cell (or when the pointer is off the table).
 * Positions are held as document positions, read again from the hovered cell's element when it is
 * still on the page, and measured from the DOM on each change. Call it in a
 * component's setup.
 */
export function useTableTarget(
  editor: Ref<Editor | null | undefined>,
  layer: Ref<HTMLElement | null>,
  /** While true the pointer does not move the controls: a menu is open or a grip is pressed */
  isHeld: () => boolean,
) {
  const target = ref<TableTarget | null>(null)
  const boxes = ref<TableBoxes | null>(null)
  const wrapper = shallowRef<HTMLElement | null>(null)
  let hovered: number | null = null
  // Collaborators' changes replace the whole document, so mapping alone loses the hovered cell
  let hoveredElement: Element | null = null

  function sync() {
    const instance = editor.value
    if (!instance || instance.isDestroyed || !instance.isEditable) return clear()
    if (hoveredElement?.isConnected) hovered = cellPosOf(instance, hoveredElement) ?? hovered
    const next = targetFrom(instance, hovered)
    if (!next) return clear()
    // Kept when unchanged, so the open menu is not rebuilt under the pointer
    if (!isSameTarget(target.value, next)) target.value = next
    wrapper.value = wrapperOf(instance, next.cell)
    measure()
  }

  function measure() {
    const instance = editor.value
    const frame = wrapper.value
    const origin = layer.value?.getBoundingClientRect()
    const current = target.value
    if (!instance || !frame?.isConnected || !origin || !current) return clear()
    const cell = instance.view.nodeDOM(current.cell)
    if (!(cell instanceof HTMLElement)) return clear()
    const local = (box: Box): Box => ({
      ...box,
      left: box.left - origin.left,
      top: box.top - origin.top,
    })

    const table = boxOf(frame.getBoundingClientRect())
    const rowElement = cell.closest('tr')
    const cellRect = cell.getBoundingClientRect()
    const shownLeft = Math.max(cellRect.left, table.left)
    const shownRight = Math.min(
      cellRect.right,
      table.left + table.width,
      document.documentElement.clientWidth,
    )
    const shownWidth = shownRight - shownLeft
    const selected = unionBox(frame.querySelectorAll('.selectedCell'))
    if (selected) fitSelectionBox(frame, selected)

    boxes.value = {
      table: local(table),
      row: rowElement && local(boxOf(rowElement.getBoundingClientRect())),
      column:
        shownWidth >= MIN_COLUMN_SHOWN
          ? local({ left: shownLeft, top: table.top, width: shownWidth, height: table.height })
          : null,
      selection: current.kind === 'cells' && selected ? local(selected) : null,
      windowRight: document.documentElement.clientWidth - origin.left,
    }
  }

  function clear() {
    target.value = null
    boxes.value = null
    wrapper.value = null
  }

  let isPending = false
  function schedule() {
    if (isPending) return
    isPending = true
    queueMicrotask(() => {
      isPending = false
      sync()
    })
  }

  function onPointerMove(event: PointerEvent) {
    const instance = editor.value
    if (!instance || instance.isDestroyed || isHeld()) return
    const element = event.target instanceof Element ? event.target : null
    if (!element || layer.value?.contains(element)) return
    const cell = element.closest('td, th')
    if (cell && instance.view.dom.contains(cell)) {
      const pos = cellPosOf(instance, cell)
      if (pos !== hovered) {
        hovered = pos
        hoveredElement = cell
        schedule()
      }
      return
    }
    if (hovered === null || isNearTable(event)) return
    hovered = null
    hoveredElement = null
    schedule()
  }

  function isNearTable(event: PointerEvent) {
    const table = wrapper.value?.getBoundingClientRect()
    if (!table) return false
    const { clientX: x, clientY: y } = event
    return (
      x >= table.left - REACH.before &&
      x <= table.right + REACH.after &&
      y >= table.top - REACH.before &&
      y <= table.bottom + REACH.after
    )
  }

  watch(
    editor,
    (instance, _previous, onCleanup) => {
      if (!instance) return
      const onTransaction = ({
        transaction,
      }: {
        transaction: { mapping: { map(pos: number): number } }
      }) => {
        if (hovered !== null) hovered = transaction.mapping.map(hovered)
        schedule()
      }
      instance.on('transaction', onTransaction)
      onCleanup(() => instance.off('transaction', onTransaction))
    },
    { immediate: true },
  )

  // A column resize writes widths into the DOM without a transaction until the pointer lets go
  watch(wrapper, (frame, _previous, onCleanup) => {
    if (!frame) return
    const observer = new ResizeObserver(schedule)
    observer.observe(frame)
    const table = frame.querySelector('table')
    if (table) observer.observe(table)
    onCleanup(() => observer.disconnect())
  })

  useEventListener(document, 'pointermove', onPointerMove, { capture: true, passive: true })
  useEventListener(document, 'scroll', schedule, { capture: true, passive: true })
  useEventListener(window, 'resize', schedule)

  return { target, boxes, wrapper, refresh: schedule }
}

function targetFrom(editor: Editor, hovered: number | null): TableTarget | null {
  const { doc } = editor.state
  const selected = selectionTarget(editor)
  if (selected && selected.cellCount > 1) return selected
  const $hovered =
    hovered === null ? null : cellAt(doc.resolve(Math.min(hovered, doc.content.size)))
  if (!$hovered) return selected
  const shape = TableShape.around($hovered)
  if (!shape) return selected
  const isCaretHere = selected?.cell === $hovered.pos
  return {
    cell: $hovered.pos,
    ...shape.cellIndex($hovered.pos),
    kind: isCaretHere ? selected.kind : null,
    cellCount: isCaretHere ? selected.cellCount : 0,
    isMerged: isMerged($hovered),
    hasHeaderRow: shape.headerRows > 0,
  }
}

/** The cell the selection is in, and what the selection holds; null outside a table */
export function selectionTarget(editor: Editor): TableTarget | null {
  const { selection } = editor.state
  // A run of cells counts from where it started
  const $cell =
    selection instanceof CellSelection ? selection.$anchorCell : cellAround(selection.$from)
  const shape = $cell && TableShape.around($cell)
  if (!$cell || !shape) return null
  const base = {
    cell: $cell.pos,
    ...shape.cellIndex($cell.pos),
    isMerged: isMerged($cell),
    hasHeaderRow: shape.headerRows > 0,
  }
  if (!(selection instanceof CellSelection)) return { ...base, kind: 'caret', cellCount: 1 }
  let cellCount = 0
  selection.forEachCell(() => cellCount++)
  const kind = selection.isRowSelection() ? 'row' : selection.isColSelection() ? 'column' : 'cells'
  return { ...base, kind, cellCount }
}

function isSameTarget(a: TableTarget | null, b: TableTarget) {
  return !!a && (Object.keys(b) as (keyof TableTarget)[]).every((key) => a[key] === b[key])
}

/** The position resolved, when it still opens on a cell */
function cellAt($pos: ResolvedPos): ResolvedPos | null {
  const role = $pos.nodeAfter?.type.spec.tableRole
  return role === 'cell' || role === 'header_cell' ? $pos : null
}

function isMerged($cell: ResolvedPos) {
  const cell = $cell.nodeAfter
  return !!cell && (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1)
}

function cellPosOf(editor: Editor, cell: Element): number | null {
  try {
    return cellAround(editor.state.doc.resolve(editor.view.posAtDOM(cell, 0)))?.pos ?? null
  } catch {
    return null
  }
}

function wrapperOf(editor: Editor, cell: number): HTMLElement | null {
  const element = editor.view.nodeDOM(cell)
  if (!(element instanceof HTMLElement)) return null
  return element.closest<HTMLElement>('.tableWrapper') ?? element.closest('table')
}
