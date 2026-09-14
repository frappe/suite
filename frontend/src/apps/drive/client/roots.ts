import { api } from './generated'
import { driveOperation } from './operation'
import type { DriveRoots } from './types'
import { query } from '@/platform/server-state'

const discoverOperation = driveOperation<Record<string, never>, DriveRoots>(api.roots_discover)

export function roots() {
  return query(discoverOperation, {}, { staleTime: 5 * 60_000, gcTime: 30 * 60_000 })
}

