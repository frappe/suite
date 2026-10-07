// The legacy Socket.IO Yjs relay sends opaque collaboration messages.
export async function relay(method, args, { fetch: send = globalThis.fetch } = {}) {
  if (method !== 'suite.sheets.api.yjs_relay') throw new TypeError('Unknown Sheets relay')
  const response = await send('/api/method/suite.sheets.api.yjs_relay', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': window.csrf_token ?? '' },
    body: JSON.stringify(args),
  })
  const body = await response.json()
  if (!response.ok || body.exc_type) {
    const error = new Error(body.exc_type || response.statusText)
    error.type = body.exc_type
    error.status = response.status
    throw error
  }
  return body.message
}

const REFUSALS = new Set([
  'PermissionError',
  'DriveForbidden',
  'DriveNotFound',
  'DriveLocked',
  'DriveLinkExpired',
])

export function isRefusal(err) {
  return REFUSALS.has(err?.type) || err?.status === 401 || err?.status === 403
}
