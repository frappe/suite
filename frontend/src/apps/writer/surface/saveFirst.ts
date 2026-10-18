import type { CollabRoom } from '@suite/collab-client'

const WAIT_MS = 10_000

type SavingRoom = Pick<CollabRoom, 'flush' | 'onChange' | 'saveState' | 'blocked' | 'paused'>

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
      if (room.saveState === 'clean' || room.saveState === 'failed') {
        finish(room.saveState === 'clean')
      }
    }

    check()
  })
}

function notSavedReason(room: SavingRoom) {
  if (room.saveState === 'failed' || (room.blocked && room.blocked !== 'offline')) {
    return 'No version was taken: your changes could not be saved.'
  }

  if (room.blocked === 'offline' || !navigator.onLine) {
    return "No version was taken: you're offline, so your changes aren't saved yet."
  }

  if (room.paused) {
    return 'No version was taken: saving is paused.'
  }

  return 'No version was taken: your changes are still saving. Try again in a moment.'
}

/** Saves this tab's edits and waits for Saved; throws why when it can't. */
export async function saveFirst(room: SavingRoom, waitMs = WAIT_MS): Promise<void> {
  void room.flush()
  if (!(await whenSaved(room, waitMs))) {
    throw new Error(notSavedReason(room))
  }
}
