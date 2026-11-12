import { api, client } from '@/api'

import type { RootsDiscoverOutput, RootUsageOutput } from './generated'

declare global {
  interface Window {
    /** The caller's Files locations at page load (served by www/suite.py). Read through `bootRoots`. */
    drive_roots?: unknown
  }
}

export type RootUsage = Pick<
  RootUsageOutput,
  'used_bytes' | 'reserved_bytes' | 'quota_bytes' | 'effective_quota'
>
export function readRootUsage(root: string, signal?: AbortSignal): Promise<RootUsage> {
  return client.query(api.drive.roots.usage, { root }, { signal })
}

/** The locations `GET roots` answered when the page loaded, or `null` when the page has none. */
export function bootRoots(): RootsDiscoverOutput | null {
  const boot = window.drive_roots
  if (!isRecord(boot) || !isLocation(boot.personal)) return null
  const organization = isLocation(boot.organization) ? boot.organization : null
  return { personal: boot.personal, organization }
}

function isLocation(value: unknown): value is RootsDiscoverOutput['personal'] {
  return isRecord(value) && typeof value.node === 'string' && typeof value.title === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
