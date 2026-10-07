/** Keep upcoming events visible across refreshes while the query revalidates them. */
import { useSessionStorage } from '@vueuse/core'
import { computed, onScopeDispose, watch } from 'vue'

import { api, useQuery, type InputOf } from '@/api'
import { useSession } from '@/platform/session'

import type { CalendarEvent } from './events'
import { operationEventsGet } from './validators'

const validateEvents: (value: unknown) => void = operationEventsGet.validateOutput

interface Snapshot {
  user: string
  from: string
  to: string
  events: CalendarEvent[]
}

/** Call in setup. A snapshot belongs to one signed-in user and one event window. */
export function useUpcomingEvents(input: () => InputOf<typeof api.calendar.events.list>) {
  const session = useSession()
  const empty: Snapshot = { user: '', from: '', to: '', events: [] }
  const snapshot = useSessionStorage('suite-calendar-upcoming-v1', empty)
  const query = useQuery(api.calendar.events.list, input)
  const cached = computed(() => {
    const window = input()
    try {
      if (
        !session.user.value?.id ||
        snapshot.value.user !== session.user.value.id ||
        snapshot.value.from !== window.from ||
        snapshot.value.to !== window.to
      )
        return undefined
      validateEvents(snapshot.value.events)
      return snapshot.value.events
    } catch {
      return undefined
    }
  })
  const events = computed(() => query.data ?? cached.value)
  watch(
    () => query.data,
    (events) => {
      if (!events || !session.user.value?.id) return
      snapshot.value = { user: session.user.value.id, ...input(), events }
    },
    { immediate: true },
  )
  onScopeDispose(
    session.onLogout(() => {
      snapshot.value = empty
    }),
  )
  return { query, events }
}
