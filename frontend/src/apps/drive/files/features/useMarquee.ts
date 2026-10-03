import { onBeforeUnmount, ref, type Ref } from 'vue'

import { boxBetween, marqueeSelection, type Box, type MarqueeItem, type Point } from './marquee'

/** Items carry this attribute, with their node name as its value. */
export const LISTING_ITEM = 'data-listing-item'

/** Movement, in pixels, before a press becomes a drag. Less is a click. */
const THRESHOLD = 4
/** Distance from the scroll container's top or bottom edge where the drag scrolls it. */
const EDGE = 48
/** Scroll per frame with the pointer at or past the edge. */
const MAX_SPEED = 20
const INTERACTIVE =
  'button, a[href], input, select, textarea, [role="checkbox"], [role="button"], [role="menuitem"], [contenteditable="true"]'
/** Controls inside an item that keep their own press, such as its menu button and checkbox. */
const ITEM_CONTROLS = '[aria-haspopup], [role="checkbox"]'

interface Gesture {
  start: Point
  pointer: { x: number; y: number }
  onItem: boolean
  additive: boolean
  prior: string[]
  active: boolean
  scroller: HTMLElement
}

/**
 * Drag to select in a listing, with a mouse. A press that moves less than
 * `THRESHOLD` stays a click. A drag selects the items its rectangle touches,
 * scrolls the container near its edges, and swallows the click that ends it.
 *
 * A drag may start on an item, because list rows fill the listing's width and
 * leave little empty space. If Drive adds drag to move, a drag that starts on
 * an item should move it instead, and only one from empty space should select.
 */
export function useMarquee(options: {
  /** The listing. Item boxes and the rectangle are relative to it. */
  area: Ref<HTMLElement | null>
  selection: () => readonly string[]
  select: (ids: string[]) => void
  /** The press became a drag. */
  onStart?: () => void
  /** A press on empty space ended without a drag. */
  onEmptyClick?: () => void
}) {
  /** The rectangle to draw, while a drag is on. */
  const box = ref<Box | null>(null)
  let gesture: Gesture | null = null
  let frame = 0
  let last: string[] = []

  function onPointerdown(event: PointerEvent) {
    const area = options.area.value
    if (!area || event.pointerType !== 'mouse' || event.button !== 0) return
    const target = event.target as Element
    const item = target.closest(`[${LISTING_ITEM}]`)
    const control = target.closest(INTERACTIVE)
    // A control outside an item, or a menu button or checkbox inside one, keeps its press.
    if (control && !(item?.contains(control) && !control.matches(ITEM_CONTROLS))) return
    gesture = {
      start: toArea(area, event),
      pointer: { x: event.clientX, y: event.clientY },
      onItem: !!item,
      additive: event.metaKey || event.ctrlKey || event.shiftKey,
      prior: [...options.selection()],
      active: false,
      scroller: scrollParent(area),
    }
    window.addEventListener('pointermove', onPointermove)
    window.addEventListener('pointerup', onPointerup)
    window.addEventListener('pointercancel', stop)
    // An image or link would start the browser's own drag and cancel the pointer.
    area.addEventListener('dragstart', preventDefault)
  }

  function onPointermove(event: PointerEvent) {
    if (!gesture) return
    gesture.pointer = { x: event.clientX, y: event.clientY }
    if (gesture.active) return
    const area = options.area.value
    if (!area) return
    const here = toArea(area, event)
    if (Math.hypot(here.x - gesture.start.x, here.y - gesture.start.y) < THRESHOLD) return
    gesture.active = true
    last = gesture.prior
    window.getSelection()?.removeAllRanges()
    document.body.style.userSelect = 'none'
    options.onStart?.()
    frame = requestAnimationFrame(tick)
  }

  function onPointerup() {
    const ended = gesture
    stop()
    if (!ended) return
    if (ended.active) swallowNextClick()
    else if (!ended.onItem) options.onEmptyClick?.()
  }

  /** One frame of an active drag: scroll near an edge, then redraw and reselect. */
  function tick() {
    const area = options.area.value
    if (!gesture?.active || !area) return
    const { scroller, pointer } = gesture
    const view =
      scroller === document.scrollingElement
        ? { top: 0, bottom: window.innerHeight }
        : scroller.getBoundingClientRect()
    const speed =
      pointer.y < view.top + EDGE
        ? -Math.min(MAX_SPEED, (view.top + EDGE - pointer.y) / 2)
        : pointer.y > view.bottom - EDGE
          ? Math.min(MAX_SPEED, (pointer.y - (view.bottom - EDGE)) / 2)
          : 0
    if (speed) scroller.scrollTop += speed

    const bounds = area.getBoundingClientRect()
    const end = toArea(area, { clientX: pointer.x, clientY: pointer.y })
    const drawn = boxBetween(gesture.start, end)
    // Kept inside the listing, so it never covers the toolbar above.
    box.value = {
      left: Math.max(0, drawn.left),
      top: Math.max(0, drawn.top),
      right: Math.min(bounds.width, drawn.right),
      bottom: Math.min(bounds.height, drawn.bottom),
    }
    const selected = marqueeSelection({
      items: itemsIn(area, bounds),
      box: drawn,
      prior: gesture.prior,
      additive: gesture.additive,
    })
    if (!sameIds(selected, last)) {
      last = selected
      options.select(selected)
    }
    frame = requestAnimationFrame(tick)
  }

  function stop() {
    cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', onPointermove)
    window.removeEventListener('pointerup', onPointerup)
    window.removeEventListener('pointercancel', stop)
    options.area.value?.removeEventListener('dragstart', preventDefault)
    if (gesture?.active) document.body.style.userSelect = ''
    gesture = null
    box.value = null
  }

  onBeforeUnmount(stop)
  return { box, onPointerdown }
}

function toArea(area: HTMLElement, event: { clientX: number; clientY: number }): Point {
  const bounds = area.getBoundingClientRect()
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

function itemsIn(area: HTMLElement, bounds: DOMRect): MarqueeItem[] {
  return [...area.querySelectorAll<HTMLElement>(`[${LISTING_ITEM}]`)].map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      id: element.getAttribute(LISTING_ITEM) ?? '',
      box: {
        left: rect.left - bounds.left,
        top: rect.top - bounds.top,
        right: rect.right - bounds.left,
        bottom: rect.bottom - bounds.top,
      },
    }
  })
}

function scrollParent(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

/** The click that ends a drag lands on whatever is under the pointer. It must not open or toggle it. */
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  // No click follows when the pointer is released outside the window.
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }))
}

function preventDefault(event: Event) {
  event.preventDefault()
}

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}
