/** Fetch the session's boot values before any app module can make a request. */
export async function loadDevBoot(): Promise<void> {
  const response = await fetch('/api/method/suite.www.suite.get_boot_data', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Failed to load Suite boot data')
  const { message } = (await response.json()) as { message: Record<string, unknown> }
  if (typeof message?.csrf_token !== 'string' || !message.csrf_token)
    throw new Error('Suite boot data has no CSRF token')
  Object.assign(window, message)
}
