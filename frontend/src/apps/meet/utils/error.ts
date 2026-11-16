/** Whether the server refused with messages written for people, as `frappe.throw` sends them. */
function hasServerMessages(error: unknown): boolean {
  return (
    error instanceof Error &&
    'messages' in error &&
    Array.isArray(error.messages) &&
    error.messages.length > 0
  )
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return normalizeErrorMessage(error)
  }

  if ('messages' in error && Array.isArray(error.messages) && error.messages.length > 0) {
    return normalizeErrorMessage(error.messages[error.messages.length - 1])
  }

  return normalizeErrorMessage(error.message || 'An unknown error occurred')
}

function normalizeErrorMessage(message: unknown): string {
  return String(message)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
}

/** The server's own refusal when it sent one, else `fallback`: never a raw network or browser error. */
export function refusalOr(error: unknown, fallback: string): string {
  return (hasServerMessages(error) && getErrorMessage(error)) || fallback
}
