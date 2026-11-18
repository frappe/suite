import dayjs from 'dayjs/esm'
import timezone from 'dayjs/esm/plugin/timezone'
import utc from 'dayjs/esm/plugin/utc'
import { setConfig } from 'frappe-ui'
import { watchEffect } from 'vue'

import { useSession, type Session } from '@/platform/session'

// `timezone` builds on `utc`, so this order is required.
dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * The zone Suite shows and reads times in: the time zone in the user's Settings,
 * else the browser's. Timestamps on the wire stay UTC.
 */
export function userTimeZone(session: Session = useSession()): string {
  return session.user.value?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * Makes the user's zone the dayjs default and the one a date picker takes "now" and "today" from,
 * and keeps it so as the session changes.
 */
export function installUserTimeZone(session: Session = useSession()): void {
  watchEffect(() => {
    const zone = userTimeZone(session)
    dayjs.tz.setDefault(zone)
    // frappe-ui names two zones, the one a picker's value is kept in and the one it is shown in:
    // in Suite they are one, as a picker holds a clock reading in the user's zone
    setConfig('systemTimezone', zone)
    setConfig('localTimezone', zone)
  })
}
