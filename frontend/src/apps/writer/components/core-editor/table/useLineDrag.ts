import type { Editor } from '@tiptap/core'
import { useEventListener } from '@vueuse/core'
import { ref, type Ref } from 'vue'

import type { Box } from './selectionRing'
import { TableEditing } from './tableEditing'
import { landingEdge, landingIndex, TableShape, type Axis } from './tableShape'
import type { TableTarget } from './useTableTarget'

const DRAG_START = 4

interface Press {
  axis: Axis
  index: number
  cell: number
  x: number
  y: number
  pointerId: number
  element: HTMLElement
  isDragging: boolean
  to: number | null
}

/**
 * A press on a row or column grip selects the line. Released in place it calls `onClick`; carried
 * 4px it drags the line, and a 3px line marks the edge it will land on. Call it in a component's
 * setup.
 */
export function useLineDrag(options: {
  editor: Ref<Editor | null | undefined>
  target: Ref<TableTarget | null>
  wrapper: Ref<HTMLElement | null>
  layer: Ref<HTMLElement | null>
  onClick: (axis: Axis) => void
}) {
  const dragging = ref<Axis | null>(null)
  const dropLine = ref<Box | null>(null)
  let press: Press | null = null

  function start(axis: Axis, event: PointerEvent) {
    const editor = options.editor.value
    const target = options.target.value
    if (event.button !== 0 || press || !editor || !target) return
    const index = axis === 'row' ? target.row : target.column
    new TableEditing(editor, target.cell).selectLine(axis, index)
    const element = event.currentTarget
    if (!(element instanceof HTMLElement)) return
    const { clientX: x, clientY: y, pointerId } = event
    press = {
      axis,
      index,
      cell: target.cell,
      x,
      y,
      pointerId,
      element,
      isDragging: false,
      to: null,
    }
    element.setPointerCapture(pointerId)
    // The press neither focuses the grip nor starts a text selection
    event.preventDefault()
  }

  function move(event: PointerEvent) {
    if (!press || press.pointerId !== event.pointerId) return
    if (!press.isDragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START) return
      if (!canDrag(press)) return
      press.isDragging = true
      dragging.value = press.axis
      document.body.classList.add('writer-table-dragging')
    }
    aim(press, press.axis === 'row' ? event.clientY : event.clientX)
  }

  function release(event: PointerEvent) {
    const current = press
    if (!current || current.pointerId !== event.pointerId) return
    end()
    const editor = options.editor.value
    if (!current.isDragging) options.onClick(current.axis)
    else if (editor && current.to !== null) {
      new TableEditing(editor, current.cell).moveLine(current.axis, current.index, current.to)
    }
  }

  function end() {
    if (!press) return
    if (press.element.hasPointerCapture(press.pointerId)) {
      press.element.releasePointerCapture(press.pointerId)
    }
    press = null
    dragging.value = null
    dropLine.value = null
    document.body.classList.remove('writer-table-dragging')
  }

  function canDrag(current: Press) {
    const editor = options.editor.value
    return !!editor && !!TableShape.at(editor.state.doc, current.cell)?.canMove(current.axis)
  }

  function aim(current: Press, at: number) {
    const frame = options.wrapper.value
    const origin = options.layer.value?.getBoundingClientRect()
    if (!frame || !origin) return
    const edges = edgesOf(frame, current.axis)
    current.to = landingIndex(edges, at, current.index)
    if (current.to === null) {
      dropLine.value = null
      return
    }
    const edge = edges[landingEdge(current.index, current.to)]
    const table = frame.getBoundingClientRect()
    dropLine.value =
      current.axis === 'row'
        ? {
            left: table.left - origin.left,
            top: edge - 1.5 - origin.top,
            width: table.width,
            height: 3,
          }
        : {
            left: edge - 1.5 - origin.left,
            top: table.top - origin.top,
            width: 3,
            height: table.height,
          }
  }

  useEventListener(document, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && press?.isDragging) {
      event.preventDefault()
      end()
    }
  })

  return {
    dragging,
    dropLine,
    isPressed: () => press !== null,
    handlers: (axis: Axis) => ({
      pointerdown: (event: PointerEvent) => start(axis, event),
      pointermove: move,
      pointerup: release,
      pointercancel: end,
    }),
  }
}

/** The edges a line can land on, in viewport pixels: each line's leading edge, then the last's trailing one */
function edgesOf(frame: HTMLElement, axis: Axis): number[] {
  if (axis === 'row') {
    const rows = [...frame.querySelectorAll('tr')].map((row) => row.getBoundingClientRect())
    return rows.length ? [...rows.map((row) => row.top), rows[rows.length - 1].bottom] : []
  }
  const cells = [...(frame.querySelector('tr')?.children ?? [])].map((cell) =>
    cell.getBoundingClientRect(),
  )
  return cells.length ? [...cells.map((cell) => cell.left), cells[cells.length - 1].right] : []
}
