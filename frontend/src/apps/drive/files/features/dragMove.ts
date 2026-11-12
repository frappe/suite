import type { DriveNode } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import { destination } from './folderPicker'
import type { Point } from './marquee'
import { nodeActions } from './nodeActions'

/** Movement, in pixels, before a press on a drag handle becomes a drag. Less is a click, as for the marquee. */
export const DRAG_THRESHOLD = 4

/** What a drag carries, and whether it is the selection or one row outside it. */
export interface DraggedItems {
  items: readonly DriveNode[]
  fromSelection: boolean
}

/** A place the items can be dropped on: a folder or root, or Trash. */
export type DropTarget =
  | {
      kind: 'folder'
      node: string
      title: string
      /** The caller's role on it, `undefined` until it loads. */
      role: number | undefined
      /** The folders it is inside, from the root down. */
      ancestors: readonly string[]
    }
  | { kind: 'trash' }

/** Whether a target takes the items, and the words the drag image shows for it. */
export type DropCheck = { status: 'allowed'; label: string } | { status: 'refused'; reason: string }

export type DragState =
  | { phase: 'pressed'; start: Point; dragged: DraggedItems }
  | { phase: 'dragging'; dragged: DraggedItems; target: DropTarget | null; check: DropCheck | null }
  /** Escape ended the drag. The button is still down, and the click it ends with must not land. */
  | { phase: 'cancelled' }

/** A press on a selected row drags the whole selection, in listing order; any other row drags alone. */
export function draggedItems(
  row: DriveNode,
  selection: readonly string[],
  rows: readonly DriveNode[],
): DraggedItems {
  if (!selection.includes(row.name)) return { items: [row], fromSelection: false }
  return { items: rows.filter((each) => selection.includes(each.name)), fromSelection: true }
}

/** A press becomes a pending drag only when every item may move. */
export function pressDrag(start: Point, dragged: DraggedItems): DragState | null {
  const movable = dragged.items.every((item) => nodeActions(item, true).move)
  return dragged.items.length && movable ? { phase: 'pressed', start, dragged } : null
}

/** The pointer moved. Past the threshold a press becomes a drag over nothing yet. */
export function moveDrag(state: DragState, pointer: Point): DragState {
  if (state.phase !== 'pressed') return state
  const distance = Math.hypot(pointer.x - state.start.x, pointer.y - state.start.y)
  if (distance < DRAG_THRESHOLD) return state
  return { phase: 'dragging', dragged: state.dragged, target: null, check: null }
}

/** The pointer is over `target`, or over no target. */
export function hoverDrag(state: DragState, target: DropTarget | null): DragState {
  if (state.phase !== 'dragging') return state
  const check = target && checkDrop(state.dragged.items, target)
  return { ...state, target, check }
}

/** Escape. Only a drag in progress cancels; a press below the threshold stays a click. */
export function cancelDrag(state: DragState): DragState {
  return state.phase === 'dragging' ? { phase: 'cancelled' } : state
}

interface DragRelease {
  drop: { dragged: DraggedItems; target: DropTarget } | null
  swallowClick: boolean
}

/**
 * The button came up. `drop` is set when the pointer is over a target that
 * takes the items. `swallowClick` is set when a drag happened, so the click
 * that follows does not open what is under the pointer.
 */
export function releaseDrag(state: DragState): DragRelease {
  if (state.phase === 'pressed') return { drop: null, swallowClick: false }
  if (state.phase === 'cancelled') return { drop: null, swallowClick: true }
  const accepted = state.target && state.check?.status === 'allowed'
  return {
    drop: accepted && state.target ? { dragged: state.dragged, target: state.target } : null,
    swallowClick: true,
  }
}

/** Whether `target` takes the items, with the move picker's own reasons where they apply. */
export function checkDrop(items: readonly DriveNode[], target: DropTarget): DropCheck {
  if (target.kind === 'trash') {
    return items.every((item) => nodeActions(item, true).trash)
      ? { status: 'allowed', label: __('Move to Trash') }
      : { status: 'refused', reason: __('You cannot move these items to Trash.') }
  }
  if (items.some((item) => item.name === target.node))
    return { status: 'refused', reason: __('A folder cannot go into itself.') }
  if (items.some((item) => target.ancestors.includes(item.name)))
    return { status: 'refused', reason: __('A folder cannot go into a folder inside it.') }
  const placed = destination('move', items, target.node, target.role)
  if (placed.status === 'unknown') return { status: 'refused', reason: __('Checking access…') }
  if (placed.status === 'refused') return { status: 'refused', reason: __(placed.reason) }
  return { status: 'allowed', label: __('Move to {0}', [target.title]) }
}
