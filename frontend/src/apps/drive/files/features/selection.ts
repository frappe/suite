export interface SelectionState {
  selected: string[]
  anchor: string | null
  /** The selection before the current Shift run, so a run that comes back shrinks. */
  base: string[]
}

/**
 * Toggles `node`, or with `range` selects from the anchor to it. With
 * `shrinks`, a range replaces the previous range of the same Shift run instead
 * of adding to it, so Shift+click back towards the anchor deselects.
 */
export function toggleSelection(
  state: SelectionState,
  node: string,
  visible: readonly string[],
  range = false,
  shrinks = false,
): SelectionState {
  if (range && state.anchor) {
    const from = visible.indexOf(state.anchor)
    const to = visible.indexOf(node)
    if (from >= 0 && to >= 0) {
      const additions = visible.slice(Math.min(from, to), Math.max(from, to) + 1)
      const kept = shrinks ? state.base : state.selected
      return {
        selected: [...new Set([...kept, ...additions])],
        anchor: state.anchor,
        base: state.base,
      }
    }
  }
  const selected = state.selected.includes(node)
    ? state.selected.filter((item) => item !== node)
    : [...state.selected, node]
  return { selected, anchor: node, base: selected }
}

/**
 * Shift+Arrow from `from` to `to`: selects from the anchor to `to`, on top of
 * the selection the Shift run started with. Without an anchor the run starts at `from`.
 */
export function extendSelection(
  state: SelectionState,
  from: string,
  to: string,
  visible: readonly string[],
): SelectionState {
  const anchor = state.anchor !== null && visible.includes(state.anchor) ? state.anchor : null
  const run = anchor ? state : { selected: state.selected, anchor: from, base: state.selected }
  return toggleSelection(run, to, visible, true, true)
}

/** A selection made at once, by Select all or the selection rectangle. */
export function selectionOf(selected: readonly string[]): SelectionState {
  return { selected: [...selected], anchor: selected.at(-1) ?? null, base: [...selected] }
}

export function selectAllLoaded(visible: readonly string[]): SelectionState {
  return selectionOf(visible)
}

export function clearSelection(): SelectionState {
  return { selected: [], anchor: null, base: [] }
}
