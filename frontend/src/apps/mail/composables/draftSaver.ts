import { computed, ref } from 'vue'

import { TransportError } from '@/platform/transport'

/**
 * Keeping one draft on the server: when to write it, what counts as written, and what to do when
 * writing fails. It knows nothing about mail beyond a serialized form of "what is on screen", so
 * every failure path can be run without a composer.
 *
 * One write at a time, and what is on the server is whatever the last *landed* write carried — not
 * what is on screen when it lands. Text typed while a save is on the wire stays unsaved and goes in
 * the next one. (Marking the draft clean on landing is what used to lose it.)
 */

/** Why the last write did not land. */
export type SaveFailure =
  // The browser reports no network: nothing to try until it comes back.
  | { kind: 'offline' }
  // No answer, or the server was in trouble. The same text may well go through later.
  | { kind: 'unavailable'; retryAfterMs?: number }
  // The server answered and said no, so trying the same text again won't change that.
  | { kind: 'refused'; message: string }

export type SaveStatus =
  // Nothing to save, and nothing on the server yet: a composition not written in.
  | 'idle'
  // On screen is ahead of the server, and a save is due or under way.
  | 'saving'
  | 'saved'
  | 'failed'
  // The draft this was written on is no longer there to update. See `gone` below.
  | 'gone'

export interface WriteOptions {
  signal?: AbortSignal
  keepalive?: boolean
}

export interface DraftSaverOptions {
  /** What is on screen, serialized. Two equal answers mean nothing has changed. */
  read: () => string
  /** False while there is nothing worth creating a draft for. */
  canSave: () => boolean
  /** Write what is on screen now. Rejects if it did not land. */
  write: (options: WriteOptions) => Promise<void>
  /** Saving is failing: put what is on screen somewhere safe. Called again for each edit. */
  keepCopy: () => void
  /** The server has everything on screen. */
  dropCopy: () => void
  /** A failure the writer should hear about once, not on every retry. */
  onRefused?: (message: string) => void
  /** Saving is over, whoever ended it. */
  onStopped?: () => void
  isOnline?: () => boolean
  debounceMs?: number
}

const DEBOUNCE_MS = 2000
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 60_000
// A request that never answers holds up every write after it (they run in call order), and never
// tells the writer that nothing was saved.
const WRITE_TIMEOUT_MS = 30_000

/**
 * A failed write, by what to do about it. A draft's id doubles as its version: each save replaces it
 * under a new one, so a 404 means someone else got there first — another tab saved over it, or it was
 * sent or deleted.
 */
export const classifySaveError = (
  error: unknown,
  isOnline = true,
): SaveFailure | { kind: 'gone' } => {
  if (error instanceof TransportError) {
    if (error.status === 404) return { kind: 'gone' }
    if (error.status === 0) return isOnline ? { kind: 'unavailable' } : { kind: 'offline' }
    if (error.status >= 500 || error.status === 429 || error.type === 'SessionExpired')
      return { kind: 'unavailable', retryAfterMs: error.retryAfterMs }
    return { kind: 'refused', message: error.message }
  }
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
    return isOnline ? { kind: 'unavailable' } : { kind: 'offline' }
  return { kind: 'refused', message: error instanceof Error ? error.message : String(error) }
}

const live = new Set<DraftSaver>()

// Signing out shouldn't sit waiting on a server that isn't answering.
const FLUSH_LIMIT_MS = 3000

/** Land what can be landed before the session ends. */
export const flushDraftSavers = async () => {
  await Promise.race([
    Promise.allSettled([...live].map((saver) => saver.saveNow())),
    new Promise((resolve) => setTimeout(resolve, FLUSH_LIMIT_MS)),
  ])
}

/** The session is over: nothing still running may write, to the server or to the device. */
export const stopDraftSavers = () => [...live].forEach((saver) => saver.stop())

export type DraftSaver = ReturnType<typeof createDraftSaver>

export const createDraftSaver = (options: DraftSaverOptions) => {
  const { read, canSave, write, keepCopy, dropCopy, onRefused } = options
  const isOnline = options.isOnline ?? (() => navigator.onLine)
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS

  const status = ref<SaveStatus>('idle')
  const failure = ref<SaveFailure>()
  const isWriting = ref(false)
  const isDirty = ref(false)

  // What the server is known to hold. Undefined until there is a baseline: then anything is ahead.
  // For a composition not saved yet that is what it opened with: nothing new has been written.
  let onServer: string | undefined
  let hasDraft = false
  let inFlight: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  let held = false
  let stopped = false
  let lastRefusal: string | undefined

  const clearTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const schedule = (ms: number) => {
    clearTimer()
    timer = setTimeout(() => void attempt(), ms)
  }
  const nextRetryMs = () => {
    const wanted = failure.value?.kind === 'unavailable' ? failure.value.retryAfterMs : undefined
    return wanted ?? Math.min(RETRY_BASE_MS * 2 ** retries, RETRY_MAX_MS)
  }

  const refreshDirty = () => (isDirty.value = read() !== onServer)

  /** Settle what the state says, from what is now known about the server. */
  const settle = () => {
    refreshDirty()
    if (status.value === 'gone') {
      keepCopy()
      return
    }
    if (failure.value) {
      status.value = 'failed'
      keepCopy()
      if (!held && failure.value.kind !== 'refused') {
        schedule(nextRetryMs())
        retries += 1
      }
      return
    }
    if (isDirty.value) {
      if (!canSave()) {
        status.value = 'idle'
        return
      }
      status.value = 'saving'
      // Typed during the save that just landed: one more, on the usual delay.
      if (!held) schedule(debounceMs)
      return
    }
    status.value = hasDraft ? 'saved' : 'idle'
    retries = 0
    dropCopy()
  }

  const fail = (error: unknown) => {
    const result = classifySaveError(error, isOnline())
    if (result.kind === 'gone') {
      clearTimer()
      failure.value = undefined
      status.value = 'gone'
    } else {
      failure.value = result
      if (result.kind === 'refused' && result.message !== lastRefusal) {
        lastRefusal = result.message
        onRefused?.(result.message)
      }
    }
  }

  const run = async (sending: string, writeOptions: WriteOptions) => {
    const controller = new AbortController()
    // A keepalive write is for a page on its way out, with nobody left to act on a timeout.
    const timeout = writeOptions.keepalive
      ? undefined
      : setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS)
    isWriting.value = true
    try {
      await write({ ...writeOptions, signal: controller.signal })
      onServer = sending
      hasDraft = true
      failure.value = undefined
      lastRefusal = undefined
    } catch (error) {
      fail(error)
    } finally {
      clearTimeout(timeout)
      isWriting.value = false
      inFlight = undefined
    }
    if (!stopped) settle()
  }

  const attempt = (writeOptions: WriteOptions = {}, force = false): Promise<void> => {
    clearTimer()
    if (inFlight) return inFlight
    if (stopped || held || status.value === 'gone') return Promise.resolve()
    refreshDirty()
    if (!isDirty.value || !canSave()) {
      settle()
      return Promise.resolve()
    }
    // No network to try. A retry by hand still does: `onLine` only ever vouches for "off".
    if (!force && !isOnline()) {
      failure.value = { kind: 'offline' }
      settle()
      return Promise.resolve()
    }
    // Read and written together, with nothing in between that could let an edit through.
    const sending = read()
    if (!failure.value) status.value = 'saving'
    inFlight = run(sending, writeOptions)
    return inFlight
  }

  const onBackOnline = () => {
    if (!failure.value || failure.value.kind === 'refused' || stopped) return
    retries = 0
    void attempt()
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') onBackOnline()
  }

  const saver = {
    status,
    failure,
    isWriting,
    isDirty,
    /** There is writing only on this screen. */
    hasUnsaved: computed(() => isDirty.value && status.value !== 'idle'),

    /** What is on screen now is what the server has. Called once a composer has opened. */
    baseline(hasServerCopy: boolean) {
      onServer = read()
      hasDraft = hasServerCopy
      isDirty.value = false
      status.value = hasServerCopy ? 'saved' : 'idle'
    },

    /** Something on screen changed. */
    edited() {
      if (stopped) return
      refreshDirty()
      if (!isDirty.value) {
        // Back to what the server has, so whatever was failing no longer matters.
        clearTimer()
        failure.value = undefined
        if (!inFlight) settle()
        return
      }
      if (status.value === 'gone') {
        keepCopy()
        return
      }
      if (failure.value) keepCopy()
      else if (canSave() && !inFlight) status.value = 'saving'
      else if (!canSave()) status.value = 'idle'
      if (!held && !inFlight) schedule(debounceMs)
    },

    /**
     * Save now, and keep going until what is on screen has landed or it can't. Resolves true if the
     * server has everything on screen.
     */
    async saveNow(writeOptions: WriteOptions = {}): Promise<boolean> {
      for (;;) {
        await inFlight
        if (stopped || held || status.value === 'gone') break
        refreshDirty()
        if (!isDirty.value || !canSave()) break
        await attempt(writeOptions)
        if (failure.value) break
      }
      return !isDirty.value && !failure.value && status.value !== 'gone'
    },

    /** The writer asked for another try, so it starts now and the back-off starts over. */
    retry() {
      if (status.value === 'gone') return Promise.resolve()
      retries = 0
      return attempt({}, true)
    },

    /** Hold every save for a send, and wait out the one under way. Never rejects. */
    async hold() {
      held = true
      clearTimer()
      await inFlight
    },
    /** Saving may go on. Called when a send did not go. */
    resume(sendError?: unknown) {
      held = false
      refreshDirty()
      if (sendError !== undefined) {
        const result = classifySaveError(sendError, isOnline())
        // The rest of a refused send is the send's own to report. A draft that is already saved
        // hasn't failed to save either, whatever became of sending it.
        if (result.kind === 'gone' || (isDirty.value && result.kind !== 'refused')) fail(sendError)
      }
      settle()
    },

    /** Forget where this draft was on the server: it will be created anew, from what is on screen. */
    startOver() {
      status.value = 'saving'
      failure.value = undefined
      onServer = undefined
      hasDraft = false
      retries = 0
      return attempt({}, true)
    },

    /** The end of this draft's saving: sent, discarded, or handed to another composer. */
    stop() {
      if (stopped) return
      stopped = true
      held = false
      clearTimer()
      window.removeEventListener('online', onBackOnline)
      document.removeEventListener('visibilitychange', onVisible)
      live.delete(saver)
      options.onStopped?.()
    },
  }

  window.addEventListener('online', onBackOnline)
  document.addEventListener('visibilitychange', onVisible)
  live.add(saver)
  return saver
}
