import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'

import { unlockNode, type UnlockOutcome } from '@/apps/drive/client/unlock'

/**
 * The unlock screen's state (spec §10.2): a password, an inline error, and a
 * lockout countdown from `Retry-After`. There is no attempts-left counter.
 */

export interface UnlockFormOptions {
  unlock?: (node: string, password: string) => Promise<UnlockOutcome>
  now?: () => number
}

/** "14:32" for fourteen minutes and 32 seconds. Rounds up, so the form never opens early. */
export function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function useUnlockForm(node: () => string, options: UnlockFormOptions = {}) {
  const unlock = options.unlock ?? unlockNode
  const now = options.now ?? Date.now
  const password = ref('')
  const error = ref('')
  const pending = ref(false)
  const lockedUntil = ref(0)
  const clock = ref(now())
  let timer: ReturnType<typeof setInterval> | undefined

  const waitMs = computed(() => Math.max(0, lockedUntil.value - clock.value))
  const disabled = computed(() => pending.value || waitMs.value > 0)
  const message = computed(() => (waitMs.value > 0 ? `Try again in ${formatWait(waitMs.value)}` : error.value))

  function stopTimer() {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  function lockFor(ms: number) {
    lockedUntil.value = now() + ms
    clock.value = now()
    stopTimer()
    timer = setInterval(() => {
      clock.value = now()
      if (clock.value >= lockedUntil.value) stopTimer()
    }, 1000)
  }

  /** Resolves `true` once the node is unlocked. */
  async function submit(): Promise<boolean> {
    if (disabled.value || !password.value) return false
    pending.value = true
    error.value = ''
    try {
      const outcome = await unlock(node(), password.value)
      if (outcome.status === 'unlocked') return true
      if (outcome.status === 'wrong-password') error.value = 'Wrong password'
      else if (outcome.status === 'locked-out') lockFor(outcome.retryAfterMs)
      else error.value = outcome.message
      password.value = ''
      return false
    } finally {
      pending.value = false
    }
  }

  if (getCurrentScope()) onScopeDispose(stopTimer)
  return { password, message, pending, disabled, submit }
}
