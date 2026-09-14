export interface SelectionState {
  selected: string[]
  anchor: string | null
}

export function toggleSelection(
  state: SelectionState,
  node: string,
  visible: readonly string[],
  range = false,
): SelectionState {
  if (range && state.anchor) {
    const from = visible.indexOf(state.anchor)
    const to = visible.indexOf(node)
    if (from >= 0 && to >= 0) {
      const additions = visible.slice(Math.min(from, to), Math.max(from, to) + 1)
      return { selected: [...new Set([...state.selected, ...additions])], anchor: state.anchor }
    }
  }
  const selected = state.selected.includes(node)
    ? state.selected.filter((item) => item !== node)
    : [...state.selected, node]
  return { selected, anchor: node }
}

export function selectAllLoaded(visible: readonly string[]): SelectionState {
  return { selected: [...visible], anchor: visible.at(-1) ?? null }
}

export function clearSelection(): SelectionState {
  return { selected: [], anchor: null }
}

