/** A room code or a same-site Meet link, never an external navigation target. */
export function meetingCodeFrom(value: string, origin: string): string {
  const code = value.trim()
  const pattern = /^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/
  if (pattern.test(code)) return code
  if (!code) return ''
  try {
    const url = new URL(code, origin)
    if (url.origin !== origin) return ''
    const match = url.pathname.match(/^\/meet\/([^/]+)\/?$/)
    const address = match?.[1]
    if (!address || ['scheduled', 'recordings'].includes(address.toLowerCase())) return ''
    const custom = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    return pattern.test(address) ||
      (address.length >= 3 && address.length <= 40 && custom.test(address))
      ? address
      : ''
  } catch {
    return ''
  }
}
