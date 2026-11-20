import type { App, ComponentPublicInstance } from 'vue'

import { useSession } from '@/platform/session'
import { transport, TransportError } from '@/platform/transport'
import { api } from '@/platform/transport/api'
import type { ErrorsPostInput } from '@/platform/transport/generated'

type Source = ErrorsPostInput['source']

/** Reports one page load may send; a render loop must not flood the log. */
const MAX_REPORTS = 10
const IGNORED_MESSAGES = ['Script error.', 'ResizeObserver loop']

const reported = new Set<string>()

/**
 * Record uncaught component, script and promise errors in the site's Error Log.
 * Worker errors that the worker does not handle arrive as window script errors.
 * Install after error tracking, which still runs, and before the API error
 * handler, which drops cancelled and already-handled requests first.
 * Returns a function that removes the window listeners.
 */
export function installErrorLog(app: App): () => void {
  const previous = app.config.errorHandler
  app.config.errorHandler = (error, instance, info) => {
    reportError(error, 'component', `Vue: ${info} in <${componentName(instance)}>`)
    if (previous) previous(error, instance, info)
    else console.error(error)
  }
  const onError = (event: ErrorEvent) => {
    if (event.error) reportError(event.error, 'script')
    else
      // No error object: a worker error, or a cross-origin script.
      reportError(
        event.message,
        'script',
        event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : '',
      )
  }
  const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason, 'promise')
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

/** Record one error. Never throws: a failed report is dropped. */
export function reportError(error: unknown, source: Source, context = ''): void {
  if (!isReportable(error) || useSession().status.value === 'guest') return
  const title = describe(error)
  const stack = [error instanceof Error ? error.stack : '', context].filter(Boolean).join('\n\n')
  const key = `${title}\n${stack}`
  if (reported.has(key) || reported.size >= MAX_REPORTS) return
  reported.add(key)
  const { pathname, search, hash } = window.location
  transport
    .request(
      api.errors.report,
      {
        source,
        title: redactUrlCredentials(title),
        stack: redactUrlCredentials(stack),
        route: redactUrlCredentials(pathname + search + hash),
      },
      { keepalive: true },
    )
    .catch(() => {})
}

/** Hide share-link codes and signed or secret query values in a string that may hold URLs. */
export function redactUrlCredentials(value: string): string {
  return value
    .replace(/\/(?:drive\/)?l\/[^/?#\s"'<>]+/gi, '/l/[Filtered]')
    .replace(/([?&#])([^=&#?\s"'<>]+)=([^&#\s"'<>]*)/g, (match, separator, key) => {
      let decoded: string
      try {
        decoded = decodeURIComponent(key).toLowerCase()
      } catch {
        // Malformed keys cannot be classified safely; discard their value.
        return `${separator}[Filtered]=[Filtered]`
      }
      return /^(link|token|s|signature|access_token|auth|authorization|password|credential|x-amz-.+|x-goog-.+)$/.test(
        decoded,
      )
        ? `${separator}${key}=[Filtered]`
        : match
    })
}

/** Whether an error is the server refusing a request: an answer, not a bug. */
export function isServerRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const exceptionType =
    ('exc_type' in error ? error.exc_type : undefined) ??
    ('excType' in error ? error.excType : undefined)
  return exceptionType === 'PermissionError' || exceptionType === 'ValidationError'
}

function isReportable(error: unknown): boolean {
  // The server records its own failures.
  if (error instanceof TransportError) return false
  if (typeof error === 'string')
    return !IGNORED_MESSAGES.some((ignored) => error.startsWith(ignored))
  if (typeof error !== 'object' || error === null) return true
  if ('name' in error && error.name === 'AbortError') return false
  return !isServerRefusal(error)
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

function componentName(instance: ComponentPublicInstance | null): string {
  return instance?.$options.name ?? instance?.$options.__name ?? 'Anonymous'
}
