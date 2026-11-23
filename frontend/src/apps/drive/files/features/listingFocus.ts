/**
 * Where the keyboard moves focus in the listing (unified frontend spec §5.13).
 * The list moves by row; the grid moves by line with Up and Down and by card
 * with Left and Right. Focus stays on the loaded items: the next window loads
 * as the last one nears the viewport, as it does when scrolling.
 */

/** The keys that move focus. Shift with any of them also extends the selection. */
export type MoveKey = 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

const MOVE_KEYS: readonly string[] = [
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
] satisfies MoveKey[]

export function isMoveKey(key: string): key is MoveKey {
  return MOVE_KEYS.includes(key)
}

/**
 * The index focus moves to from `index` among `count` items laid out in
 * `columns` columns, or `null` when it stays. A list has one column, and Left
 * and Right do nothing there. `rtl` swaps Left and Right.
 */
export function nextIndex(
  key: MoveKey,
  index: number,
  count: number,
  columns: number,
  rtl = false,
): number | null {
  const last = count - 1
  if (last < 0) return null
  const moved = (to: number) => (to === index || to < 0 || to > last ? null : to)
  switch (key) {
    case 'Home':
      return moved(0)
    case 'End':
      return moved(last)
    case 'ArrowUp':
      return moved(index - columns)
    case 'ArrowDown':
      // A short last line: Down from the line above it goes to its last card.
      if (index + columns > last && line(index, columns) < line(last, columns)) return last
      return moved(index + columns)
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (columns === 1) return null
      const forward = (key === 'ArrowRight') !== rtl
      return moved(index + (forward ? 1 : -1))
    }
  }
}

function line(index: number, columns: number) {
  return Math.floor(index / columns)
}

/** How many cards share the first line of a grid, read from where the browser placed them. */
export function columnsOf(cards: readonly HTMLElement[]): number {
  const top = cards[0]?.offsetTop
  if (top === undefined) return 1
  const first = cards.findIndex((card) => card.offsetTop !== top)
  return first === -1 ? cards.length : first
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', usage: 'search' })

/**
 * The item a typed prefix jumps to, searching after `from` and wrapping, or
 * `null`. Case and accents do not count. One letter typed again and again
 * steps through the items that start with it; a longer prefix stays on the
 * current item while it still matches.
 */
export function typeAheadMatch(
  titles: readonly string[],
  from: number,
  typed: string,
): number | null {
  if (!typed || !titles.length) return null
  const letters = [...typed]
  const repeated = letters.every((letter) => letter === letters[0])
  const prefix = repeated ? (letters[0] ?? '') : typed
  const start = repeated ? from + 1 : Math.max(from, 0)
  for (let offset = 0; offset < titles.length; offset++) {
    const index = (start + offset) % titles.length
    const title = titles[index] ?? ''
    if (collator.compare(title.slice(0, prefix.length), prefix) === 0) return index
  }
  return null
}

/** A key that types into the type-ahead: one letter or digit, with no modifier but Shift. */
export function isTypeAheadKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return false
  return /^[\p{L}\p{N}]$/u.test(event.key)
}
