/** Fetch the session's boot values before any app module can make a request. */
export async function loadDevBoot(): Promise<void> {
  const response = await fetch('/api/method/suite.www.suite.get_boot_data', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Failed to load Suite boot data')
  const body: unknown = await response.json()
  const message = body && typeof body === 'object' && 'message' in body ? body.message : undefined
  if (
    !message ||
    typeof message !== 'object' ||
    !('csrf_token' in message) ||
    typeof message.csrf_token !== 'string' ||
    !message.csrf_token
  )
    throw new Error('Suite boot data has no CSRF token')
  Object.assign(window, message)
}
