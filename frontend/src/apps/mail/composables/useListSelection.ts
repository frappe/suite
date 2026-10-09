import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useMobileSelection, useScreenSize } from '@/apps/mail/utils/composables'

/**
 * The ticked threads of a thread list, shared by a single account's list and the All accounts one.
 *
 * Threads are named by key: a thread id in one account's list, account plus thread id where several
 * accounts share a list (thread ids are only unique within an account). `keys` is every loaded thread
 * in list order, which is what select-all and a shift-click range read; `groupKeys` names the threads
 * under a date header, which is what the header's checkbox ticks.
 *
 * A shift-click ticks the range from the last tick; ticking onto a stack or a header ticks every
 * thread it stands for. Nothing here forces a collapsed day or stack open: ticking it is how you act
 * on the whole set at once, and the header or stack row shows its own box ticked.
 */
export const useListSelection = ({
  keys,
  groupKeys,
}: {
  keys: () => string[]
  groupKeys: (dateKey: string) => string[] | undefined
}) => {
  const selections = ref<string[]>([])
  const lastSelected = ref<string[]>()

  // Held while a click lands, so a shift-click can tick a range.
  const isShiftPressed = ref(false)
  const trackShift = (e: KeyboardEvent) => (isShiftPressed.value = e.shiftKey)
  const releaseShift = (e: KeyboardEvent) => e.key === 'Shift' && (isShiftPressed.value = false)
  onMounted(() => {
    window.addEventListener('keydown', trackShift)
    window.addEventListener('keyup', releaseShift)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', trackShift)
    window.removeEventListener('keyup', releaseShift)
  })

  // On a phone, ticking a thread enters selection mode: rows show checkboxes, the toolbar turns
  // contextual, and the action bar covers the bottom nav.
  const { isMobile } = useScreenSize()
  const { setMobileSelectionActive } = useMobileSelection()
  const mobileSelectionMode = computed(() => isMobile.value && selections.value.length > 0)
  watch(mobileSelectionMode, (active) => setMobileSelectionActive(active))
  onUnmounted(() => setMobileSelectionActive(false))

  const isAllSelected = computed(() => !!keys().length && selections.value.length === keys().length)

  const rangeTo = (key: string) => {
    if (!(isShiftPressed.value && lastSelected.value?.length)) return []
    const all = keys()
    const current = all.indexOf(key)
    const first = all.indexOf(lastSelected.value[0])
    const last = all.indexOf(lastSelected.value.at(-1)!)
    const farthest = Math.abs(current - first) > Math.abs(current - last) ? first : last
    const [lower, higher] = [farthest, current].sort((a, b) => a - b)
    return all.slice(lower, higher + 1)
  }

  /** Ticks or unticks `keys`; a click with Shift held takes the range from the last tick too. */
  const toggleSelect = (keys: string[], selected: boolean, isKeyboardSelect = false) => {
    const touched = new Set([...keys, ...(isKeyboardSelect ? [] : rangeTo(keys[0]))])
    if (selected) selections.value = [...new Set([...selections.value, ...touched])]
    else selections.value = selections.value.filter((key) => !touched.has(key))
    lastSelected.value = keys
  }

  const toggleSelectAll = (selected: boolean) => {
    selections.value = selected ? [...keys()] : []
    lastSelected.value = undefined
  }

  const resetSelections = () => toggleSelectAll(false)

  // Derived rather than stored, so they can never drift from what is ticked.
  const isGroupSelected = (dateKey: string) =>
    !!groupKeys(dateKey)?.every((key) => selections.value.includes(key))
  const isStackSelected = (keys: string[]) => keys.every((key) => selections.value.includes(key))

  return {
    selections,
    isAllSelected,
    mobileSelectionMode,
    toggleSelect,
    toggleSelectAll,
    resetSelections,
    isGroupSelected,
    isStackSelected,
  }
}
