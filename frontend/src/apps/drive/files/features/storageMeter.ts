import type { RootUsage } from '@/apps/drive/client/roots'
import { formatBytes } from '@/apps/drive/files/internal/format'
import { translate as __ } from '@/platform/translation'

/** How full a root is: `near` from 90% of its quota, `full` at the quota. */
export type StorageLevel = 'ok' | 'near' | 'full'

export interface StorageMeter {
  /** The usage figures, or `Almost full` and `Storage full` once the root nears its quota. */
  label: string
  /** `2.4 GB of 10 GB used`, or `2.4 GB used` when the root has no quota. */
  usage: string
  /** The bar's fill, 0 to 100. `null` when the root has no quota, so there is no bar. */
  percent: number | null
  level: StorageLevel
}

const NEAR_FULL = 0.9

export function storageMeter(
  usage: Pick<RootUsage, 'used_bytes' | 'effective_quota'>,
): StorageMeter {
  const used = formatBytes(usage.used_bytes)
  if (usage.effective_quota <= 0) {
    const label = __('{0} used', [used])
    return { label, usage: label, percent: null, level: 'ok' }
  }

  const share = usage.used_bytes / usage.effective_quota
  // Any use shows at least a sliver, so a nearly empty root does not look unused.
  const percent = usage.used_bytes > 0 ? Math.min(100, Math.max(1, share * 100)) : 0
  const level: StorageLevel = share >= 1 ? 'full' : share >= NEAR_FULL ? 'near' : 'ok'
  const figures = __('{0} of {1} used', [used, formatBytes(usage.effective_quota)])
  const label = { ok: figures, near: __('Almost full'), full: __('Storage full') }[level]
  return { label, usage: figures, percent, level }
}
