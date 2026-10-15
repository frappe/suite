// Web Locks only cut duplicate sends between tabs; where they are missing, every session counts as free
export function holdLock(name: string): Promise<(() => void) | null> {
  const locks = globalThis.navigator?.locks
  const releaseNothing = () => {}
  if (!locks) {
    return Promise.resolve(releaseNothing)
  }

  return new Promise((resolve) => {
    const options: LockOptions = { ifAvailable: true }
    // The lock is held until the promise it returns settles, which is when the caller releases it
    const holdUntilReleased = (lock: Lock | null) => {
      if (!lock) {
        resolve(null)
        return
      }

      return new Promise<void>((release) => resolve(release))
    }

    const lockFailed = () => resolve(releaseNothing)
    void locks.request(name, options, holdUntilReleased).catch(lockFailed)
  })
}

// Without Web Locks every session counts as free, including those of tabs still open
export function hasLocks() {
  return !!globalThis.navigator?.locks
}
