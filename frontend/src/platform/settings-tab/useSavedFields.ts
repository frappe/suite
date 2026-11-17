import { ref, watch, type Ref } from 'vue'

/**
 * Settings fields that each save on change, as a switch or a select in a `SettingsRow` does.
 *
 * `shown` is what the controls show. A change shows at once. Saves run one at a time, in the order
 * they were made. `write` is called when the change is made, so it reads its target (an account,
 * say) then; the send it returns runs in turn and gets the values the server last confirmed, so a
 * request never carries another field's change that has not landed. When the last save of a field
 * settles, the field shows what the server stores: the new value when it saved, or the last
 * confirmed value when it failed. The send owns the error feedback; a failed save does not reject.
 *
 * Saves outlive the scope: closing Settings does not stop a change already made. So the send must
 * not be bound to the scope either; use `client.mutation`, not a component's `useMutation`, whose
 * runs are cancelled when the scope goes.
 *
 * `source` is the server's copy. A new copy becomes the confirmed values, and the controls follow
 * it, except a field that still has a save on its way. A source that goes empty leaves the
 * confirmed values as they were, so a queued save is always sent. The source must stay on one
 * target (one account, say) for the life of the scope; for a new target, make a new scope.
 */
export function useSavedFields<T extends object>(
  source: () => T | null | undefined,
  write: (change: Partial<T>) => (confirmed: Readonly<T>) => Promise<unknown>,
) {
  // SAFETY: `ref<T>()` unwraps T in its type; the values here are plain field values.
  const shown = ref<T>() as Ref<T | undefined>
  // Once the source loads, the values the server last confirmed. Reloads and landed saves update
  // this one object in place, so a queued save reads the latest of them when its turn comes.
  let confirmed: T | undefined
  const pending = new Map<keyof T, number>()
  // The saves not yet settled, and the last of them. The first starts at once.
  let queued = 0
  let queue: Promise<void> = Promise.resolve()

  watch(
    source,
    (data) => {
      if (data) confirmed = confirmed ? Object.assign(confirmed, data) : { ...data }
      const next = data ? { ...data } : undefined
      const current = shown.value
      if (next && current)
        for (const [field, count] of pending) if (count) next[field] = current[field]
      shown.value = next
    },
    { immediate: true },
  )

  function save<K extends keyof T>(field: K, value: T[K]): Promise<void> {
    const current = shown.value
    const base = confirmed
    if (!current || !base || current[field] === value) return Promise.resolve()
    current[field] = value
    pending.set(field, (pending.get(field) ?? 0) + 1)
    const change: Partial<T> = {}
    change[field] = value
    const send = write(change)
    const step = async () => {
      try {
        await send({ ...base })
        base[field] = value
      } catch {
        // `write` reported it; the field goes back below.
      } finally {
        const left = (pending.get(field) ?? 1) - 1
        pending.set(field, left)
        if (!left && shown.value) shown.value[field] = base[field]
        queued -= 1
      }
    }
    queue = queued ? queue.then(step) : step()
    queued += 1
    return queue
  }

  return { shown, save }
}
