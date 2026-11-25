import { useSessionStorage } from '@vueuse/core'
import { computed, onScopeDispose, watch } from 'vue'

import { useSession } from '@/platform/session'

type Section = 'upcoming' | 'rooms' | 'recordings' | 'recording-folder'

interface Snapshot<T> {
  user: string
  scope: string
  value: T
}

export function useMeetHomeSnapshot<T>(
  section: Section,
  current: () => T | undefined,
  scope: () => string = () => '',
) {
  const session = useSession()
  const snapshot = useSessionStorage<Snapshot<T> | null>(`suite-meet-home-${section}-v1`, null, {
    serializer: {
      read: (value) => JSON.parse(value),
      write: (value) => JSON.stringify(value),
    },
  })

  watch(
    current,
    (value) => {
      const user = session.user.value?.id
      if (user && value !== undefined) snapshot.value = { user, scope: scope(), value }
    },
    { immediate: true },
  )
  onScopeDispose(
    session.onLogout(() => {
      snapshot.value = null
    }),
  )

  return computed(() => {
    const user = session.user.value?.id
    if (!user) return undefined
    const saved = snapshot.value
    return current() ?? (saved?.user === user && saved.scope === scope() ? saved.value : undefined)
  })
}
