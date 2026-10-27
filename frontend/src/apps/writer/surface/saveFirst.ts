import { HOLD_UP_MS } from '@/apps/writer/collab/timeout'
import type { CollabRoom, RoomStatus } from '@/platform/collab'

type SavingRoom = Pick<CollabRoom, 'flush' | 'onChange'> & {
  readonly status: Pick<RoomStatus, 'saveState' | 'blockReason' | 'pauseReason'>
}

// Resolves whether every edit on this device was saved before the wait ran out
function whenSaved(room: SavingRoom, waitMs: number) {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => finish(false), waitMs)
    const stopWatching = room.onChange(check)

    function finish(isSaved: boolean) {
      clearTimeout(timer)
      stopWatching()
      resolve(isSaved)
    }

    function check() {
      const { saveState } = room.status
      if (saveState === 'clean' || saveState === 'failed') {
        finish(saveState === 'clean')
      }
    }

    check()
  })
}

function notSavedReason(room: SavingRoom) {
  const { saveState, blockReason, pauseReason } = room.status
  if (saveState === 'failed' || (blockReason && blockReason !== 'offline')) {
    return 'No version was taken: your changes could not be saved.'
  }

  if (blockReason === 'offline' || !navigator.onLine) {
    return "No version was taken: you're offline, so your changes aren't saved yet."
  }

  if (pauseReason) {
    return 'No version was taken: saving is paused.'
  }

  return 'No version was taken: your changes are still saving. Try again in a moment.'
}

/** Saves this tab's edits and waits for Saved; throws why when it can't. */
export async function saveFirst(room: SavingRoom, waitMs = HOLD_UP_MS): Promise<void> {
  void room.flush()
  if (!(await whenSaved(room, waitMs))) {
    throw new Error(notSavedReason(room))
  }
}
