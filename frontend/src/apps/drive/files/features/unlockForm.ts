import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'

import { unlockNode, type UnlockOutcome } from '@/apps/drive/client/unlock'

/**
 * The unlock screen's state (spec §10.2): a password, an inline error, and a
 * lockout countdown from `Retry-After`. There is no attempts-left counter.
 */

type DeadlineStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface UnlockFormOptions {
  unlock?: (node: string, password: string) => Promise<UnlockOutcome>
  now?: () => number
  /** Where the lockout deadline survives a reload. `sessionStorage` by default. */
  storage?: DeadlineStorage | null
}

const LOCKOUT_KEY = 'suite:drive-unlock-lockout:'

/** "14:32" for fourteen minutes and 32 seconds. Rounds up, so the form never opens early. */
export function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function useUnlockForm(node: () => string, options: UnlockFormOptions = {}) {
  const unlock = options.unlock ?? unlockNode
  const now = options.now ?? Date.now
  const storage = options.storage === undefined ? browserSessionStorage() : options.storage
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

  // Only the deadline is kept, per node, so a reload during a lockout keeps the form disabled.
  function lockUntil(deadline: number) {
    lockedUntil.value = deadline
    clock.value = now()
    stopTimer()
    if (deadline <= clock.value) return
    timer = setInterval(() => {
      clock.value = now()
      if (clock.value >= lockedUntil.value) {
        stopTimer()
        write(node(), null)
      }
    }, 1000)
  }

  function write(key: string, deadline: number | null) {
    try {
      if (deadline === null) storage?.removeItem(LOCKOUT_KEY + key)
      else storage?.setItem(LOCKOUT_KEY + key, String(deadline))
    } catch {
      // Blocked storage: the countdown lasts until the page closes.
    }
  }

  function restore(key: string) {
    let saved = 0
    try {
      saved = Number(storage?.getItem(LOCKOUT_KEY + key) ?? 0)
    } catch {
      saved = 0
    }
    if (Number.isFinite(saved) && saved > now()) lockUntil(saved)
    else {
      lockUntil(0)
      write(key, null)
    }
  }

  watch(node, (key) => {
    error.value = ''
    password.value = ''
    restore(key)
  }, { immediate: true })

  /** Resolves `true` once the node is unlocked. */
  async function submit(): Promise<boolean> {
    if (disabled.value || !password.value) return false
    pending.value = true
    error.value = ''
    try {
      const key = node()
      const outcome = await unlock(key, password.value)
      if (outcome.status === 'unlocked') {
        write(key, null)
        return true
      }
      if (outcome.status === 'wrong-password') error.value = 'Wrong password'
      else if (outcome.status === 'locked-out') {
        const deadline = now() + outcome.retryAfterMs
        write(key, deadline)
        lockUntil(deadline)
      } else error.value = outcome.message
      return false
    } finally {
      // Every outcome clears the password, a successful one too.
      password.value = ''
      pending.value = false
    }
  }

  if (getCurrentScope()) onScopeDispose(stopTimer)
  return { password, message, pending, disabled, submit }
}

function browserSessionStorage(): DeadlineStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}
