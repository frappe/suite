import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

/**
 * A page that needs the full width, such as the Slides editor, asks the shell
 * to hide its desktop rail while it is mounted, or while a condition holds.
 * The shell reads the request; the page does not import the shell.
 */
const requests = ref(0)

/** Whether a mounted page asks the shell to hide its rail. */
export const railHidden = computed(() => requests.value > 0)

/**
 * Asks the shell to hide its rail until the calling scope ends. With `when`,
 * the request follows the condition instead, and still ends with the scope.
 */
export function useHideRail(when: MaybeRefOrGetter<boolean> = true): void {
  let isRequested = false
  function request(isWanted: boolean) {
    if (isWanted === isRequested) return

    isRequested = isWanted
    if (isWanted) {
      requests.value += 1
    } else {
      requests.value -= 1
    }
  }

  watch(() => toValue(when), request, { immediate: true })
  onScopeDispose(() => request(false))
}
