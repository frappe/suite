// Refusals the editor treats as "access narrowed", not as a retryable failure.
const REFUSALS = new Set<unknown>([
  'PermissionError',
  'DriveForbidden',
  'DriveNotFound',
  'DriveLocked',
  'DriveLinkExpired',
])

export function isRefusal(err: unknown): boolean {
  const e = err as { type?: unknown; status?: unknown } | null | undefined
  return REFUSALS.has(e?.type) || e?.status === 401 || e?.status === 403
}
