import { ref } from 'vue'
import { frappeRequest, setConfig, toast } from 'frappe-ui'

import { translate } from '@/boot/translation'

/** Error shape thrown by frappe-ui's `frappeRequest` (the type is not re-exported). */
type RequestError = Error & { exc_type?: string; messages?: string[] }

// Raised by the backend (suite.mail.jmap.connection) whenever Stalwart — the server behind
// mail, calendar and contacts — cannot be reached. Handled centrally here so every failing
// resource collapses into ONE friendly toast instead of silent console errors.
const MAIL_SERVER_UNAVAILABLE_EXC = 'MailServerUnavailableError'
const MAIL_SERVER_UNAVAILABLE_TOAST_ID = 'mail-server-unavailable'

/**
 * True once any request has failed because the mail server is unreachable. The mail layout
 * swaps the whole page for a "mail server unavailable" view from this — needed because outages
 * during initial routing happen before any toast container is mounted, so a toast alone would
 * be lost. Cleared only by a reload (the view's Retry), since a later unrelated request
 * succeeding doesn't prove the mail server is back.
 */
export const mailServerUnavailable = ref(false)

function handleMailServerUnavailable(error: RequestError) {
  const message = translate(
    'The mail server is temporarily unavailable. Please try again in a few minutes.',
  )
  // Rewrite the error so resource-level handlers that toast `error.message` /
  // `error.messages[0]` show the friendly text instead of "url ExcType".
  error.message = message
  error.messages = [message]

  if (mailServerUnavailable.value) return
  mailServerUnavailable.value = true
  // One toast on first detection, for surfaces that don't render a full-page state
  // (e.g. calendar). The fixed id collapses concurrent failures into a single toast.
  toast.error(message, { id: MAIL_SERVER_UNAVAILABLE_TOAST_ID })
}

/**
 * Unified frappe-ui resource configuration for the whole suite.
 *
 * All 7 apps share ONE API base: requests go to the Frappe site that serves
 * this SPA (suite.localhost). frappe-ui's `frappeRequest` reads
 * `window.csrf_token` (injected by index.html / suite.html) and talks to
 * `/api/method/...` on the same origin, so per-app fetch wrappers
 * (sheets/utils/api.js, drive resourceFetcher overrides, etc.) collapse onto
 * this single configuration.
 *
 * Call `configureFrappeUI()` exactly once, before mounting the app.
 */
export function configureFrappeUI() {
  setConfig('resourceFetcher', (options: Parameters<typeof frappeRequest>[0]) =>
    frappeRequest(options).catch((error: RequestError) => {
      if (error?.exc_type === MAIL_SERVER_UNAVAILABLE_EXC) {
        handleMailServerUnavailable(error)
      }
      throw error
    }),
  )
}
