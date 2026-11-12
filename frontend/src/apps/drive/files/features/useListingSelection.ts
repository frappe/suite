import { computed, ref } from 'vue'

import {
  clearSelection,
  extendSelection,
  selectAllLoaded,
  selectionOf,
  toggleSelection,
  type SelectionState,
} from './selection'

/**
 * The listing's selection: the checked items, the anchor of a Shift range, and
 * whether selection mode is on. Selection mode is on while anything is checked,
 * or after "Select" started an empty one on a phone. `ids` are the loaded
 * items in their listed order. Call it in a component's setup.
 */
export function useListingSelection(ids: () => readonly string[]) {
  const state = ref<SelectionState>(clearSelection())
  const selecting = ref(false)
  const selected = computed({
    get: () => state.value.selected,
    set: (next: string[]) => {
      state.value = selectionOf(next)
    },
  })
  const selectionMode = computed(() => selecting.value || state.value.selected.length > 0)

  return {
    selected,
    selectionMode,
    /** Toggles one item, or with `range` selects from the anchor to it. */
    toggle(id: string, range: boolean) {
      state.value = toggleSelection(state.value, id, ids(), range)
    },
    /** Shift+Arrow: grows or shrinks the range as focus moves from `from` to `to`. */
    extend(from: string, to: string) {
      state.value = extendSelection(state.value, from, to, ids())
    },
    selectAll() {
      state.value = selectAllLoaded(ids())
    },
    /** Starts selection mode with nothing checked. */
    start() {
      selecting.value = true
    },
    /** Leaves selection mode. */
    clear() {
      state.value = clearSelection()
      selecting.value = false
    },
    /** Keeps only `kept` checked, such as the items a batch could not change. None left ends selection mode. */
    keepOnly(kept: string[]) {
      state.value = { selected: kept, anchor: null, base: kept }
      if (!kept.length) selecting.value = false
    },
  }
}
