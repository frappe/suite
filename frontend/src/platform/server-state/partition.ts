import { randomId } from '@/platform/random-id'

/** Persisted entity partitions use opaque tokens tied to the browser's current identity. */
const KEY = 'suite-api-identity'
export function identityPartition(identity?: string | null, renew = false): string {
  if (identity === undefined || typeof sessionStorage === 'undefined') return randomId()
  try {
    const raw = sessionStorage.getItem(KEY)
    const saved: unknown = raw ? JSON.parse(raw) : null
    if (!renew && isPartition(saved) && saved.identity === identity) return saved.token
    const token = randomId()
    sessionStorage.setItem(KEY, JSON.stringify({ identity, token }))
    return token
  } catch {
    return randomId()
  }
}
function isPartition(value: unknown): value is { identity: string | null; token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'identity' in value &&
    'token' in value &&
    typeof value.token === 'string'
  )
}
