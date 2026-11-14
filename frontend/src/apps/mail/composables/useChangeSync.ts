import { useEventListener } from '@vueuse/core'
import type { Socket } from 'socket.io-client'
import { onScopeDispose } from 'vue'

import { api, client } from '@/api'

// Often enough that mail changed elsewhere is on the list before the reader looks for it; with
// nothing new, each one is a single Email/changes call per account.
const SYNC_INTERVAL = 15_000
// While the asks keep failing (the mail server down, a state it can no longer answer from), each
// failure doubles the wait, up to this. The first answer brings it back to the interval.
const MAX_SYNC_INTERVAL = 5 * 60_000

/**
 * Keep the open lists up with the mail server, push or no push.
 *
 * A push from the mail server is what tells the lists that mail arrived or changed elsewhere, and
 * it needs to reach this site over HTTPS. Where it can't, or while the socket was down (a laptop
 * lid), the lists only learned on their next poll, and only if a count had moved. This asks the
 * server to fetch the changes itself — when the app opens, every 15 s while the page is looked
 * at, the moment it is looked at again, and when the socket comes back — and what it finds
 * reaches every open list as a push's changes do. Call it in a component's setup.
 *
 * It stops for good once `serverUnavailable` holds: the outage page stays until Mail is reloaded.
 */
export function useChangeSync(socket: Socket, serverUnavailable: () => boolean) {
  let inFlight = false
  let failures = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stopped = () => disposed || serverUnavailable()
  const scheduleNext = () => {
    clearTimeout(timer)
    if (stopped()) return
    timer = setTimeout(sync, Math.min(SYNC_INTERVAL * 2 ** failures, MAX_SYNC_INTERVAL))
  }
  function sync() {
    if (inFlight || stopped()) return
    if (document.visibilityState !== 'visible' || !navigator.onLine) return scheduleNext()
    // Back from a sleep the socket may have given up; the changes it would carry need it up.
    if (socket.disconnected) socket.connect()
    inFlight = true
    void client
      .mutation(api.mail.changes.sync, undefined, { silent: true })
      .then((found) => {
        failures = 0
        // The socket brings this tab the same as every other; without one, the answer does, to the
        // same listeners.
        if (socket.connected) return
        const hear = (event: string, ...args: unknown[]) =>
          socket.listeners(event).forEach((listener) => listener(...args))
        if (found.new_mail_in.length) hear('new_mail_created', found.new_mail_in)
        if (found.changed) hear('mail_changed')
      })
      .catch(() => {
        failures += 1
      })
      .finally(() => {
        inFlight = false
        scheduleNext()
      })
  }
  // Looking again asks at once, unless the asks are failing: then only the wait decides, or every
  // switch back to the tab would ask again.
  const syncUnlessFailing = () => {
    if (!failures) sync()
  }

  // At once too: with no push, the server's view may be hours behind when the app opens.
  sync()
  useEventListener(document, 'visibilitychange', syncUnlessFailing)
  useEventListener(window, 'online', syncUnlessFailing)
  // A reconnect means events were missed while it was away.
  socket.io.on('reconnect', syncUnlessFailing)
  onScopeDispose(() => {
    disposed = true
    clearTimeout(timer)
    socket.io.off('reconnect', syncUnlessFailing)
  })
}
