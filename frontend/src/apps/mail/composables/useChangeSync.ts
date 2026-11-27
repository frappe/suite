import { useEventListener } from '@vueuse/core'
import type { Socket } from 'socket.io-client'
import { inject, onScopeDispose, provide, type InjectionKey } from 'vue'

import { api, client } from '@/api'

// Often enough that mail changed elsewhere is on the list before the reader looks for it; with
// nothing new, each one is a single Email/changes call per account.
const SYNC_INTERVAL = 15_000
// While the asks keep failing (the mail server down, a state it can no longer answer from), each
// failure doubles the wait, up to this. The first answer brings it back to the interval.
const MAX_SYNC_INTERVAL = 5 * 60_000
// An ask not answered by now is given up, as a failure: one that never answers (a phone left it
// hanging when it put the app away) would otherwise hold back every ask after it, and a pull to
// refresh that joins it.
const SYNC_TIMEOUT = 30_000

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
 * Returns the ask itself, for a reader asking now (pull to refresh): it settles once the answer is
 * in, and joins an ask already out rather than sending a second.
 */
export function useChangeSync(socket: Socket, serverUnavailable: () => boolean) {
  let inFlight: Promise<void> | undefined
  let failures = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stopped = () => disposed || serverUnavailable()
  const scheduleNext = () => {
    clearTimeout(timer)
    if (stopped()) return
    timer = setTimeout(sync, Math.min(SYNC_INTERVAL * 2 ** failures, MAX_SYNC_INTERVAL))
  }
  function sync(): Promise<void> {
    if (inFlight) return inFlight
    if (stopped()) return Promise.resolve()
    if (document.visibilityState !== 'visible' || !navigator.onLine) {
      scheduleNext()
      return Promise.resolve()
    }
    // A socket put down for good (the server sent it away) stays down, and the changes it would
    // carry need it up. One still on its way back is left to socket.io: asking again while its
    // CONNECT awaits an answer sends a second one, the server drops the connection, and every
    // reconnect after that drops it again, with a sync each time. This relies on initSocket's
    // unlimited reconnects: with a cap, a socket that gave up would stay active and never come back.
    if (!socket.active) socket.connect()
    // The server announces what it finds while the ask is out: only a socket up for all of it hears.
    const heardLive = socket.connected
    const timeout = new AbortController()
    const giveUp = setTimeout(() => timeout.abort(), SYNC_TIMEOUT)
    inFlight = client
      .mutation(api.mail.changes.sync, undefined, { silent: true, signal: timeout.signal })
      .then((found) => {
        // Some account could not be fetched; the others were, and are handed on below.
        failures = found.failed ? failures + 1 : 0
        // The socket brings this tab the same as every other; without one, the answer does, to the
        // same listeners.
        if (heardLive && socket.connected) return
        const hear = (event: string, ...args: unknown[]) =>
          socket.listeners(event).forEach((listener) => listener(...args))
        if (found.new_mail_in.length) hear('new_mail_created', found.new_mail_in)
        if (found.changed) hear('mail_changed')
      })
      .catch(() => {
        failures += 1
      })
      .finally(() => {
        clearTimeout(giveUp)
        inFlight = undefined
        scheduleNext()
      })
    return inFlight
  }
  // Looking again asks at once, unless the asks are failing: then only the wait decides, or every
  // switch back to the tab would ask again.
  const syncUnlessFailing = () => {
    if (!failures) void sync()
  }

  // At once too: with no push, the server's view may be hours behind when the app opens.
  void sync()
  useEventListener(document, 'visibilitychange', syncUnlessFailing)
  useEventListener(window, 'online', syncUnlessFailing)
  // A reconnect means events were missed while it was away.
  socket.io.on('reconnect', syncUnlessFailing)
  onScopeDispose(() => {
    disposed = true
    clearTimeout(timer)
    socket.io.off('reconnect', syncUnlessFailing)
  })
  return sync
}

const changeSyncKey: InjectionKey<() => Promise<void>> = Symbol('mailChangeSync')

/** Hands the layout's change sync (see useChangeSync) to the lists below it. */
export const provideChangeSync = (sync: () => Promise<void>) => provide(changeSyncKey, sync)

/**
 * Ask the mail server for its changes now; settles once they are in. Outside Mail's layout (a
 * test mounting a list alone) there is nothing to ask, and it settles at once.
 */
export const useSyncNow = () => inject(changeSyncKey, () => Promise.resolve())
