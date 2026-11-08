import { computed, nextTick, ref, watch, type Ref } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'

import { columnsOf, isMoveKey, isTypeAheadKey, nextIndex, typeAheadMatch } from './listingFocus'
import { LISTING_ITEM } from './useMarquee'

/** An item's element carries its node name in this attribute; its wrapper in grid view carries `LISTING_ITEM`. */
const ITEM = 'data-node'
/** Controls inside an item that are not the item itself. */
const ITEM_CONTROLS = '[aria-haspopup], [role="checkbox"]'
/** How long a pause ends a typed prefix. */
const TYPE_AHEAD_PAUSE = 500

/**
 * The listing's keyboard focus (unified frontend spec §5.13). The listing is
 * one Tab stop: only the current item is tabbable, the arrow keys, Home and
 * End move focus without selecting, and Shift with them extends the
 * selection. Typing jumps to the next item whose title starts with what was typed.
 *
 * The current item is the one focused last. The DOM says which element has
 * focus, so this keeps no second copy of it. Call it in a component's setup.
 */
export function useListingFocus(options: {
  root: Ref<HTMLElement | null>
  rows: () => readonly DriveNode[]
  selection: () => readonly string[]
  /** Cards in a grid, where Left and Right move too. */
  grid: () => boolean
  /** Shift moved focus from one item to another. */
  extend: (from: DriveNode, to: DriveNode) => void
}) {
  const current = ref<string | null>(null)
  let typed = ''
  let typedAt = 0

  /** The item that holds the Tab stop: the one focused last, else the first selected, else the first. */
  const tabStop = computed(() => {
    const rows = options.rows()
    const has = (id: string | null) => !!id && rows.some((row) => row.name === id)
    if (has(current.value)) return current.value
    return options.selection().find(has) ?? rows[0]?.name ?? null
  })

  // An item that leaves the listing, such as one moved to Trash, hands the
  // Tab stop to the item that takes its place, or to the new last item. When
  // it had focus, focus follows, or goes to the listing when it is empty.
  watch(
    () => options.rows().map((row) => row.name),
    (now, before) => {
      const id = current.value
      if (!id || now.includes(id)) return
      const focused = document.activeElement?.closest(`[${ITEM}]`)?.getAttribute(ITEM) === id
      const index = Math.min(Math.max(before.indexOf(id), 0), now.length - 1)
      current.value = now[index] ?? null
      if (!focused) return
      void nextTick(() => {
        if (current.value) focusRow(current.value)
        else options.root.value?.focus({ preventScroll: true })
      })
    },
    { flush: 'pre' },
  )

  /** The item's own element. */
  function elementOf(id: string): HTMLElement | undefined {
    return [...(options.root.value?.querySelectorAll<HTMLElement>(`[${ITEM}]`) ?? [])].find(
      (element) => element.getAttribute(ITEM) === id,
    )
  }

  /** Focuses the item and scrolls it into view: just enough, or to the middle with `reveal`. */
  function focusRow(id: string, { reveal = false } = {}): boolean {
    const element = elementOf(id)
    if (!element) return false
    current.value = id
    element.focus({ preventScroll: true })
    element.scrollIntoView?.({ block: reveal ? 'center' : 'nearest' })
    return true
  }

  /** The item `element` is, when it is an item's own element and not a control inside one. */
  function itemOf(element: EventTarget | null): DriveNode | null {
    if (!(element instanceof HTMLElement) || !options.root.value?.contains(element)) return null
    if (element.matches(ITEM_CONTROLS)) return null
    const id = element.closest(`[${LISTING_ITEM}]`)?.getAttribute(LISTING_ITEM)
    return options.rows().find((row) => row.name === id) ?? null
  }

  /** The item whose own element has visible keyboard focus, or `null`. */
  function focusedRow(): DriveNode | null {
    const focused = document.activeElement
    return focused?.matches(':focus-visible') ? itemOf(focused) : null
  }

  function onFocusin(event: FocusEvent) {
    const id = event.target instanceof Element ? event.target.getAttribute(ITEM) : null
    if (id) current.value = id
  }

  function columns(): number {
    if (!options.grid()) return 1
    const cards = [
      ...(options.root.value?.querySelectorAll<HTMLElement>(`[${LISTING_ITEM}]`) ?? []),
    ]
    return columnsOf(cards)
  }

  function move(event: KeyboardEvent, from: DriveNode, index: number): boolean {
    if (!isMoveKey(event.key) || event.altKey || event.ctrlKey || event.metaKey) return false
    const rows = options.rows()
    const rtl = !!options.root.value && getComputedStyle(options.root.value).direction === 'rtl'
    const next = nextIndex(event.key, index, rows.length, columns(), rtl)
    const to = next === null ? undefined : rows[next]
    // A key that moves nowhere keeps its usual meaning: Down on the last row
    // scrolls, which also brings the next window in.
    if (!to) return false
    focusRow(to.name)
    if (event.shiftKey) options.extend(from, to)
    return true
  }

  function jump(event: KeyboardEvent, index: number): boolean {
    const now = Date.now()
    if (now - typedAt > TYPE_AHEAD_PAUSE) typed = ''
    // While a prefix is being typed, Space is part of it, as in "Q3 report".
    const isSpace = event.key === ' ' && typed !== ''
    if (!isSpace && !isTypeAheadKey(event)) return false
    typed += event.key
    typedAt = now
    const titles = options.rows().map((row) => row.title)
    const match = typeAheadMatch(titles, index, typed)
    const row = match === null ? undefined : options.rows()[match]
    if (row) focusRow(row.name)
    return true
  }

  /** Handles a key pressed on an item. Answers whether the key was used. */
  function onKeydown(event: KeyboardEvent): boolean {
    const from = itemOf(event.target)
    if (!from) return false
    const index = options.rows().indexOf(from)
    const used = move(event, from, index) || jump(event, index)
    if (used) event.preventDefault()
    return used
  }

  return { tabStop, focusRow, focusedRow, onFocusin, onKeydown }
}
