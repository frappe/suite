import { useMediaQuery } from '@vueuse/core'
import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  reactive,
  ref,
  shallowReadonly,
  shallowRef,
  watch,
} from 'vue'

import { api, client, useQuery } from '@/api'
import { DRIVE_ROLES, type DriveNode, type DriveRoots } from '@/apps/drive/client/types'
import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'
import { isTweakOn } from '@/platform/tweaks'

import { LOCATION_LABELS, locationTitle } from '../internal/locations'
import {
  cancelDrag,
  draggedItems,
  hoverDrag,
  moveDrag,
  pressDrag,
  releaseDrag,
  type DraggedItems,
  type DragState,
  type DropTarget,
} from './dragMove'
import { moveAccessChange, type MoveAccessChange } from './folderPicker'
import type { Point } from './marquee'
import { scrollNearEdge, scrollParent, swallowNextClick } from './useMarquee'
import { useWorkspaceName } from './useWorkspaceName'

/** The sidebar's Trash carries this as its `data-drop-target`. */
export const TRASH_TARGET = 'trash'
/** A press inside an element with this attribute can start a drag. */
const DRAG_HANDLE = 'data-drag-handle'
/** A target's element carries its node, or `TRASH_TARGET`. */
const DROP_TARGET = 'data-drop-target'
/** The breadcrumbs' wrapper. Each crumb's link holds a `DROP_TARGET` marker it renders itself. */
const DROP_CRUMBS = 'data-drop-crumbs'

/**
 * Drag to move in a folder listing, with a mouse (`t16-drag-move`). A press on
 * an item's drag handle that moves past the threshold drags the item, or the
 * selection when the item is in it, onto a folder row or card, a breadcrumb,
 * or a sidebar location. Escape cancels. A drop asks first when the move
 * gives someone access (unified frontend §5.7), then calls `move` or `trash`,
 * which report with Undo as the menus do. Call it in a component's setup.
 */
export function useDragMove(options: {
  /** The page shows a folder listing the user can rearrange. */
  enabled: () => boolean
  rows: () => readonly DriveNode[]
  selection: () => readonly string[]
  /** The open folder, with `access` and `breadcrumbs`. */
  folder: () => DriveNode | null | undefined
  roots: () => DriveRoots | null | undefined
  move: (dragged: DraggedItems, folder: { node: string; title: string }) => Promise<unknown>
  trash: (dragged: DraggedItems) => Promise<unknown>
}) {
  const instance = getCurrentInstance()
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)')
  const state = shallowRef<DragState | null>(null)
  /** Where the pointer is, for the drag image. */
  const pointer = ref<Point>({ x: 0, y: 0 })
  const review = reactive({ open: false, change: null as MoveAccessChange | null })
  const workspace = useWorkspaceName()
  let scroller: HTMLElement | null = null
  let frame = 0
  let hovered: string | null = null
  let answer: ((confirmed: boolean) => void) | null = null

  /** The open folder and its ancestors, as targets, from the root down. */
  const trail = computed(() => {
    const folder = options.folder()
    if (!folder) return []
    const steps = [
      ...(folder.breadcrumbs ?? []),
      { name: folder.name, title: folder.title, role: folder.access?.role },
    ]
    return steps.map((step, index) => ({
      kind: 'folder' as const,
      node: step.name,
      title: locationTitle(step, options.roots()),
      role: step.role,
      ancestors: steps.slice(0, index).map((each) => each.name),
    }))
  })

  const dragging = computed(() => state.value?.phase === 'dragging')
  const organizationNode = computed(() => options.roots()?.organization?.node ?? null)
  // `DriveRoots` carries no role. The Organization root's loads once a drag starts, unless the
  // trail already has it; until then the root refuses.
  const organization = useQuery(api.drive.nodes.get, () =>
    dragging.value &&
    organizationNode.value &&
    !trail.value.some((step) => step.node === organizationNode.value)
      ? { node: organizationNode.value, expand: 'access' }
      : false,
  )

  function targetFor(key: string): DropTarget | null {
    if (key === TRASH_TARGET) return { kind: 'trash' }
    const step = trail.value.find((each) => each.node === key)
    if (step) return step
    const ancestors = trail.value.map((each) => each.node)
    const row = options.rows().find((each) => each.name === key && each.kind === 'folder')
    if (row)
      return { kind: 'folder', node: key, title: row.title, role: row.access?.role, ancestors }
    const roots = options.roots()
    // The caller owns their personal root.
    if (key === roots?.personal.node) {
      const title = LOCATION_LABELS.personal
      return { kind: 'folder', node: key, title, role: DRIVE_ROLES.manage, ancestors: [] }
    }
    if (key === organizationNode.value) {
      const title = LOCATION_LABELS.organization
      const role = organization.data?.access?.role
      return { kind: 'folder', node: key, title, role, ancestors: [] }
    }
    return null
  }

  function isOn() {
    return isTweakOn('t16-drag-move') && finePointer.value && options.enabled()
  }

  /** A press on an item. Answers whether the drag took it; otherwise the marquee may. */
  function press(event: PointerEvent, row: DriveNode): boolean {
    if (!isOn() || event.pointerType !== 'mouse' || event.button !== 0) return false
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
    const handle = event.target instanceof Element && event.target.closest(`[${DRAG_HANDLE}]`)
    if (!(handle instanceof HTMLElement)) return false
    const start = { x: event.clientX, y: event.clientY }
    const pressed = pressDrag(start, draggedItems(row, options.selection(), options.rows()))
    if (!pressed) return false
    state.value = pressed
    pointer.value = start
    scroller = scrollParent(handle)
    window.addEventListener('pointermove', onPointermove)
    window.addEventListener('pointerup', onPointerup)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    window.addEventListener('keydown', onKeydown, { capture: true })
    // An image or link would start the browser's own drag and cancel the pointer.
    window.addEventListener('dragstart', preventDefault, { capture: true })
    return true
  }

  function onPointermove(event: PointerEvent) {
    const current = state.value
    if (!current) return
    pointer.value = { x: event.clientX, y: event.clientY }
    if (current.phase !== 'pressed') return
    state.value = moveDrag(current, pointer.value)
    if (state.value.phase !== 'dragging') return
    window.getSelection()?.removeAllRanges()
    document.body.style.userSelect = 'none'
    frame = requestAnimationFrame(tick)
  }

  /** One frame of a drag: scroll near an edge, then find what is under the pointer. */
  function tick() {
    const current = state.value
    if (current?.phase !== 'dragging') return
    if (scroller) scrollNearEdge(scroller, pointer.value.y)
    const key = targetKeyAt(pointer.value)
    const target = key ? targetFor(key) : null
    // A role that arrives mid-hover changes the answer, so the check runs again for it.
    const role = target?.kind === 'folder' ? target.role : undefined
    const known = current.target?.kind === 'folder' ? current.target.role : undefined
    if (key !== hovered || role !== known) {
      hovered = key
      state.value = hoverDrag(current, target)
    }
    frame = requestAnimationFrame(tick)
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || state.value?.phase !== 'dragging') return
    // Escape also clears the selection in the listing; here it only ends the drag.
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelAnimationFrame(frame)
    state.value = cancelDrag(state.value)
  }

  function onPointerup() {
    const ended = state.value
    stop()
    if (!ended) return
    const { drop, swallowClick } = releaseDrag(ended)
    if (swallowClick) swallowNextClick()
    if (!drop) return
    const done =
      drop.target.kind === 'trash'
        ? options.trash(drop.dragged)
        : dropInto(drop.dragged, drop.target)
    // No Vue handler awaits a window listener, so a rejection is reported here, as menus do.
    done.catch((error: unknown) => {
      const report = instance?.appContext.config.errorHandler
      if (report) report(error, instance?.proxy ?? null, 'drag to move')
      else console.error(error)
    })
  }

  async function dropInto(dragged: DraggedItems, target: DropTarget & { kind: 'folder' }) {
    let change: MoveAccessChange | null
    try {
      const previews = await Promise.all(
        dragged.items.map((item) =>
          client.query(api.drive.nodes.previewMove, { node: item.name, parent_node: target.node }),
        ),
      )
      change = moveAccessChange(previews, workspace.value)
    } catch {
      toast.error(__('Could not check who would get access. Nothing was moved.'))
      return
    }
    if (change && !(await confirmAccess(change))) return
    await options.move(dragged, { node: target.node, title: target.title })
  }

  /** Opens the move confirmation. Resolves `true` on Move, `false` when it closes otherwise. */
  function confirmAccess(change: MoveAccessChange): Promise<boolean> {
    answer?.(false)
    review.change = change
    review.open = true
    return new Promise((resolve) => (answer = resolve))
  }
  /** Move answers `true`. The dialog closes before it confirms, so `closeReview` answers later. */
  function settleReview(confirmed: boolean) {
    answer?.(confirmed)
    answer = null
  }
  /** Cancel, Escape or a click outside closed the confirmation: nothing moves. */
  function closeReview() {
    review.open = false
  }
  watch(
    () => review.open,
    (open) => {
      if (!open) settleReview(false)
    },
  )

  function stop() {
    cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', onPointermove)
    window.removeEventListener('pointerup', onPointerup)
    window.removeEventListener('pointercancel', stop)
    window.removeEventListener('blur', stop)
    window.removeEventListener('keydown', onKeydown, { capture: true })
    window.removeEventListener('dragstart', preventDefault, { capture: true })
    if (state.value && state.value.phase !== 'pressed') document.body.style.userSelect = ''
    state.value = null
    hovered = null
    scroller = null
  }
  onBeforeUnmount(() => {
    stop()
    settleReview(false)
  })

  /** What the drag image shows, while a drag is on. */
  const image = computed(() => {
    const current = state.value
    return current?.phase === 'dragging'
      ? { items: current.dragged.items, check: current.check }
      : null
  })

  return {
    isOn,
    press,
    /** The item is being dragged, so it shows faded. */
    isDragged(id: string) {
      const current = state.value
      return current?.phase === 'dragging' && current.dragged.items.some((item) => item.name === id)
    },
    /** The pointer is over this target, and it takes the items. */
    accepts(key: string) {
      const current = state.value
      if (current?.phase !== 'dragging' || current.check?.status !== 'allowed') return false
      const target = current.target
      return (target?.kind === 'trash' ? TRASH_TARGET : target?.node) === key
    },
    image,
    pointer,
    review: shallowReadonly(review),
    settleReview,
    closeReview,
  }
}

export type DragMove = ReturnType<typeof useDragMove>

/** The target under the point. A crumb's marker sits inside its link, beside the label the pointer is on. */
function targetKeyAt(point: Point): string | null {
  const element = document.elementFromPoint(point.x, point.y)
  const marked =
    element?.closest(`[${DROP_TARGET}]`) ??
    element?.closest(`[${DROP_CRUMBS}] a`)?.querySelector(`[${DROP_TARGET}]`)
  return marked?.getAttribute(DROP_TARGET) ?? null
}

function preventDefault(event: Event) {
  event.preventDefault()
}
