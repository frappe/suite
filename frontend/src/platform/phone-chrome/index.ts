import { computed, onScopeDispose, ref } from 'vue'

/**
 * A route with `phoneChrome: 'page'` draws its own phone chrome. A page of
 * that route that cannot draw it (Mail's server outage view has no tab bar)
 * asks for the shell's chrome back while it is mounted. The shell reads the
 * request; the page does not import the shell.
 */
const requests = ref(0)

/** Whether a mounted page asks the shell to draw its phone chrome. */
export const shellPhoneChromeRequested = computed(() => requests.value > 0)

/** Asks for the shell's phone chrome until the calling scope ends. */
export function useShellPhoneChrome(): void {
  requests.value += 1
  onScopeDispose(() => {
    requests.value -= 1
  })
}
