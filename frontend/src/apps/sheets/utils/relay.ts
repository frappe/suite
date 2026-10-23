// The legacy Socket.IO Yjs relay sends opaque collaboration messages.

/** A failed relay call: the server's exception type and the HTTP status. */
export interface RelayError extends Error {
  type: string | undefined
  status: number
}

export async function relay(
  method: string,
  args: unknown,
  { fetch: send = globalThis.fetch }: { fetch?: typeof fetch | undefined } = {},
): Promise<unknown> {
  if (method !== 'suite.sheets.api.yjs_relay') throw new TypeError('Unknown Sheets relay')
  const response = await send('/api/method/suite.sheets.api.yjs_relay', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': window.csrf_token ?? '' },
    body: JSON.stringify(args),
  })
  const body = await response.json()
  if (!response.ok || body.exc_type) {
    const error = new Error(body.exc_type || response.statusText) as RelayError
    error.type = body.exc_type
    error.status = response.status
    throw error
  }
  return body.message
}

// Refusals the editor treats as "access narrowed", not as a retryable failure.
const REFUSALS = new Set<unknown>([
  'PermissionError',
  'DriveForbidden',
  'DriveNotFound',
  'DriveLocked',
  'DriveLinkExpired',
])

export function isRefusal(err: unknown): boolean {
  const e = err as Partial<RelayError> | null | undefined
  return REFUSALS.has(e?.type) || e?.status === 401 || e?.status === 403
}
