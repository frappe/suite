import { api, client } from '@/api'

import type { RootUsageOutput } from './generated'

export type RootUsage = Pick<
  RootUsageOutput,
  'used_bytes' | 'reserved_bytes' | 'quota_bytes' | 'effective_quota'
>
export function readRootUsage(root: string, signal?: AbortSignal): Promise<RootUsage> {
  return client.query(api.drive.roots.usage, { root }, { signal })
}
