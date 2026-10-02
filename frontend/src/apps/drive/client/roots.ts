
import { api } from './generated'
import { driveOperation } from './operation'
import type { DriveRoots } from './types'
import { mutation, query } from '@/platform/server-state'
import { transport } from '@/platform/transport'

export interface RootUsage {
  used_bytes: number
  reserved_bytes: number
  quota_bytes: number | null
  /** Bytes the root may hold. `0` means no limit. */
  effective_quota: number
}

const discoverOperation = driveOperation<Record<string, never>, DriveRoots>(api.roots_discover)
const usageOperation = driveOperation<{ root: string }, RootUsage>(api.root_usage)
const emptyTrashOperation = driveOperation<{ root: string }, { purged: number }>(api.root_empty_trash)

export function roots() {
  return query(discoverOperation, {}, { staleTime: 5 * 60_000, gcTime: 30 * 60_000 })
}

/**
 * One root's counters, without the breakdown the Statistics tab reads. Uploads,
 * deletes and Empty Trash invalidate it.
 */
export function rootUsage(root: string) {
  return query(usageOperation, { root })
}

/** One root's counters, read once outside any cache. `root` is the root's node. */
export function readRootUsage(root: string, signal?: AbortSignal): Promise<RootUsage> {
  return transport.request(usageOperation, { root }, { signal })
}

/** Deletes everything in one root's Trash forever, under MANAGE on the root. */
export const emptyTrash = () => mutation(emptyTrashOperation, {
  invalidates: ['node_children', 'view_list', 'root_usage'],
})
