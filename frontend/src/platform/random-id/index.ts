/**
 * A random id that also works over plain HTTP. `crypto.randomUUID()` exists only in a secure
 * context, and self-hosted sites commonly run without one; `crypto.getRandomValues()` does not
 * need it.
 */
export function randomId(): string {
  // `typeof crypto`, not `crypto?.x`: optional chaining does not guard an undeclared global.
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    }
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}
