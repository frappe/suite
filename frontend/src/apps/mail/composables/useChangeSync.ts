import { useEventListener, useIntervalFn } from '@vueuse/core'
import type { Socket } from 'socket.io-client'
import { onScopeDispose } from 'vue'

import { api, client } from '@/api'

// Often enough that mail changed elsewhere is on the list before the reader looks for it; with
// nothing new, each one is a single Email/changes call per account.
const SYNC_INTERVAL = 15_000

/**
 * Keep the open lists up with the mail server, push or no push.
 *
 * A push from the mail server is what tells the lists that mail arrived or changed elsewhere, and
 * it needs to reach this site over HTTPS. Where it can't, or while the socket was down (a laptop
 * lid), the lists only learned on their next poll, and only if a count had moved. This asks the
 * server to fetch the changes itself — when the app opens, every 15 s while the page is looked
 * at, the moment it is looked at again, and when the socket comes back — and what it finds
 * reaches every open list as a push's changes do. Call it in a component's setup.
 */
export function useChangeSync(socket: Socket) {
  let inFlight = false
  const sync = () => {
    if (inFlight || document.visibilityState !== 'visible' || !navigator.onLine) return
    // Back from a sleep the socket may have given up; the changes it would carry need it up.
    if (socket.disconnected) socket.connect()
    inFlight = true
    void client
      .mutation(api.mail.changes.sync, undefined, { silent: true })
      .then((found) => {
        // The socket brings this tab the same as every other; without one, the answer does, to the
        // same listeners.
        if (socket.connected) return
        const hear = (event: string, ...args: unknown[]) =>
          socket.listeners(event).forEach((listener) => listener(...args))
        if (found.new_mail_in.length) hear('new_mail_created', found.new_mail_in)
        if (found.changed) hear('mail_changed')
      })
      .catch(() => {})
      .finally(() => (inFlight = false))
  }

  // At once too: with no push, the server's view may be hours behind when the app opens.
  sync()
  useIntervalFn(sync, SYNC_INTERVAL)
  useEventListener(document, 'visibilitychange', sync)
  useEventListener(window, 'online', sync)
  // A reconnect means events were missed while it was away.
  socket.io.on('reconnect', sync)
  onScopeDispose(() => socket.io.off('reconnect', sync))
}
