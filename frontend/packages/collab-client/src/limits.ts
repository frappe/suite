import type { Limits } from './frames'

// Whether a change of about `bytes` can be saved: `too_large` never, `near_full` only if a compaction makes room
export function sizeCheck(
  limits: Limits | null,
  bytes: number,
): 'fits' | 'too_large' | 'near_full' {
  if (!limits) return 'fits'
  if (bytes > limits.edit_max) return 'too_large'
  if (limits.state_bytes + limits.tail_bound + bytes > limits.state_max) return 'near_full'
  return 'fits'
}
