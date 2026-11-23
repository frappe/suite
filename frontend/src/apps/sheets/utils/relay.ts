// Refusals the editor treats as "access narrowed", not as a retryable failure.
const REFUSALS = new Set<unknown>([
  'PermissionError',
  'DriveForbidden',
  'DriveNotFound',
  'DriveLocked',
  'DriveLinkExpired',
])

export function isRefusal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const type = 'type' in err ? err.type : undefined
  const status = 'status' in err ? err.status : undefined
  return REFUSALS.has(type) || status === 401 || status === 403
}
