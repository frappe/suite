import type { Realtime } from '@/platform/realtime'
import type { Operation } from '@/platform/transport'

type Invalidate = (matches: (reference: Operation) => boolean) => void

/**
 * Drive's change events come in bursts: an upload of N files sends N. One refresh per window
 * covers a burst. The window starts at the first event and later events do not extend it, so a
 * long burst still refreshes every window (unified frontend §5.9).
 */
const DRIVE_CHANGE_WINDOW_MS = 400

export function subscribeDriveChanges(
  realtime: Pick<Realtime, 'subscribe'>,
  invalidate: Invalidate,
): void {
  const isDriveRead = (reference: Operation) => reference.owner === 'drive'
  // `drive:recent` says only the user's Recent list changed. It is one of the views.
  const isDriveView = (reference: Operation) =>
    isDriveRead(reference) && reference.id === 'view_list'
  let pending: ReturnType<typeof setTimeout> | undefined
  let everything = false
  const changed = (all: boolean) => {
    everything ||= all
    pending ??= setTimeout(() => {
      const matches = everything ? isDriveRead : isDriveView
      pending = undefined
      everything = false
      invalidate(matches)
    }, DRIVE_CHANGE_WINDOW_MS)
  }
  realtime.subscribe('drive:changed', () => changed(true))
  realtime.subscribe('drive:recent', () => changed(false))
}
