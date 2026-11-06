import { computed, onBeforeUnmount, shallowRef, watch, type HTMLAttributes, type Ref } from 'vue'

/** Faint enough to read as structure, not content. */
export const SKELETON_BAR = '!bg-surface-gray-2 motion-reduce:animate-none'
const SKELETON_DELAY = 180

/** A placeholder cell between the name and the actions; `hasDate` draws a date's bar. */
export interface SkeletonCell {
  class?: HTMLAttributes['class']
  hasDate?: boolean
}

/**
 * True while a load is too new for placeholders, so a fast load shows nothing
 * rather than a flash. `delay` is in milliseconds.
 */
export function useSkeletonDelay(
  isLoading: Ref<boolean>,
  delay: () => number = () => SKELETON_DELAY,
) {
  const isDue = shallowRef(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(isLoading, restart, { immediate: true })
  onBeforeUnmount(() => clearTimeout(timer))
  return computed(() => isLoading.value && !isDue.value)

  function restart(isLoadingNow: boolean) {
    clearTimeout(timer)
    isDue.value = false
    if (isLoadingNow) {
      timer = setTimeout(markDue, delay())
    }
  }

  function markDue() {
    isDue.value = true
  }
}
