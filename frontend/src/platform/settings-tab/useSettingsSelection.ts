import { computed, reactive, ref } from 'vue'

/**
 * Which rows of a Settings list are selected, for a list with bulk actions.
 * Give each `SettingsListRow` `v-bind="selection.row(key)"` and put a
 * `SettingsSelectionBar` above the rows.
 *
 * `keys` are the rows the list shows, in order. Only those count as selected,
 * so a row that leaves the list (removed, or hidden by a search) drops out of
 * the selection and a bulk action never reaches a row the user cannot see.
 */
export function useSettingsSelection(keys: () => readonly string[]) {
  const chosen = ref(new Set<string>())

  const selected = computed(() => keys().filter((key) => chosen.value.has(key)))
  const count = computed(() => selected.value.length)

  function toggle(key: string, on = !chosen.value.has(key)) {
    if (on) chosen.value.add(key)
    else chosen.value.delete(key)
  }
  function clear() {
    chosen.value.clear()
  }
  /** Selects every row, or none when every row is selected already. */
  function toggleAll() {
    const all = keys()
    if (count.value === all.length) clear()
    else for (const key of all) chosen.value.add(key)
  }

  return reactive({
    /** The selected keys, in list order. */
    selected,
    count,
    /** Every row is selected. */
    all: computed(() => count.value > 0 && count.value === keys().length),
    toggle,
    toggleAll,
    clear,
    /** The selection props of one `SettingsListRow`. */
    row: (key: string) => ({
      selected: chosen.value.has(key),
      selecting: count.value > 0,
      'onUpdate:selected': (on: boolean) => toggle(key, on),
    }),
  })
}

export type SettingsSelection = ReturnType<typeof useSettingsSelection>
