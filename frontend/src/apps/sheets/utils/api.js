// Sheets API helper, ported onto the suite's shared frappe-ui resource layer.
//
// The standalone app hand-rolled a fetch wrapper that read window.csrf_token
// and parsed _server_messages. Under the suite, frappe-ui is configured once
// (src/boot/config.ts -> setConfig('resourceFetcher', frappeRequest)) and its
// `call()` already targets `/api/method/...` on the SPA origin with the shared
// CSRF token, so the normal path now delegates to frappe-ui's `call` directly.
//
// Two app-specific needs are preserved on top of frappe-ui:
//   1. `keepalive` and `fetch` — fire-and-forget saves from onBeforeUnmount must
//      outlive the document, and the `/d/` surface sends through the Drive
//      session's fetch. frappe-ui's call() has neither option, so both fall back
//      to a raw fetch (same endpoint/CSRF).
//   2. `err.excType` / `err.status` — callers (usePersistence) branch on the
//      Frappe exception class without regexing the message; we re-attach those
//      onto whatever error is thrown.

import { call as frappeCall } from 'frappe-ui'

function csrfToken() {
  return window.csrf_token ?? ''
}

function buildServerError(json) {
  let msg = json?.exc_type || 'Server error'
  if (json?._server_messages) {
    try {
      const parsed = JSON.parse(json._server_messages)
      const first = Array.isArray(parsed) ? JSON.parse(parsed[0]) : parsed
      msg = first.message || msg
    } catch (_) {
      msg = json._server_messages
    }
  }
  return new Error(msg)
}

function decorateError(err, excType, status) {
  if (excType) err.excType = excType
  else if (err.excType == null) err.excType = ''
  if (status != null) err.status = status
  return err
}

// Raw path: a plain fetch, for two needs frappe-ui's call() does not cover.
// `keepalive` lets the request outlive the document. `fetch` sends through a
// caller's fetch, which is how the `/d/` surface adds the Drive link header.
async function rawCall(method, args, { keepalive = false, fetch: send = globalThis.fetch } = {}) {
  const res = await send(`/api/method/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken(),
    },
    body: JSON.stringify(args),
    keepalive,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.exc) {
    throw decorateError(buildServerError(json), json.exc_type || '', res.status)
  }
  return json.message
}

export async function call(method, args = {}, { keepalive = false, fetch } = {}) {
  if (keepalive || fetch) {
    return rawCall(method, args, { keepalive, fetch })
  }
  try {
    return await frappeCall(method, args)
  } catch (err) {
    // frappe-ui throws the parsed error; surface excType/status for callers
    // that branch on the Frappe exception class (PermissionError, etc.).
    throw decorateError(
      err instanceof Error ? err : new Error(String(err?.message || err)),
      err?.exc_type || '',
      err?.statusCode ?? err?.status,
    )
  }
}

// The refusals that mean "this caller may not do that here": Frappe's own, and
// Drive's for a linked sheet. Drive answers a caller below Read with
// `DriveNotFound`, so it is a refusal too.
const REFUSALS = new Set(['PermissionError', 'DriveForbidden', 'DriveNotFound', 'DriveLocked', 'DriveLinkExpired'])

export function isRefusal(err) {
  return REFUSALS.has(err?.excType) || err?.status === 401 || err?.status === 403
}
