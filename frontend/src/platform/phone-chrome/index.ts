import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

/**
 * A route with `phoneChrome: 'page'` draws its own phone chrome. A page of
 * that route asks for the shell's chrome back while it is mounted, or while a
 * condition holds: Mail's list pages want the shell's bottom nav, but a thread
 * opened from the list is full screen. The shell reads the request; the page
 * does not import the shell.
 */
const requests = ref(0)

/** Whether a mounted page asks the shell to draw its phone chrome. */
export const shellPhoneChromeRequested = computed(() => requests.value > 0)

/**
 * Asks for the shell's phone chrome until the calling scope ends. With `when`,
 * the request follows the condition instead, and still ends with the scope.
 */
export function useShellPhoneChrome(when: MaybeRefOrGetter<boolean> = true): void {
  let requested = false
  const request = (on: boolean) => {
    if (on === requested) return
    requested = on
    requests.value += on ? 1 : -1
  }
  watch(() => toValue(when), request, { immediate: true })
  onScopeDispose(() => request(false))
}
