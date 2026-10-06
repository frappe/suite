import type { OutputOf } from '@/api'
import type { api } from '@/apps/calendar/client/api'

export type CalendarSearchResult = OutputOf<typeof api.events.search>[number] & {
  resultType: 'calendar-event'
}
