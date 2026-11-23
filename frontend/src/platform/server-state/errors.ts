import type { App } from 'vue'

import { TransportError } from '@/platform/transport'

const handledMutations = new WeakSet<TransportError>()

/** Install after error tracking so unexpected failures still reach its handler. */
export function installApiErrorHandler(app: App): void {
  const report = app.config.errorHandler
  app.config.errorHandler = (error, instance, info) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError'
    )
      return
    if (error instanceof TransportError && handledMutations.has(error) && error.status < 500) return
    if (report) report(error, instance, info)
    else console.error(error)
  }
}

/** Feedback or a silent caller owns this refusal; recording it does not consume rejection. */
export function recordMutationFailure(error: unknown): void {
  if (error instanceof TransportError) handledMutations.add(error)
}
