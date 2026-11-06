import { api, client } from '@/api'
import { nodeGrants, type GrantList } from '@/apps/drive/client/grants'
import { canManage, type DriveNode } from '@/apps/drive/client/types'
import type { ImperativeClient } from '@/platform/server-state/types'

/** What the share dialog reads to open: the node with the caller's access, and who has access. */
export interface ShareReads {
  node: Promise<DriveNode>
  /** `null` when the fresh node says the caller cannot manage it (spec §7.2). */
  list: Promise<GrantList | null>
}

/**
 * Starts both reads. When `known` says the caller manages the node, who has
 * access is read at the same time; otherwise only after the node answers.
 */
export function readShare(
  nodeId: string,
  known: DriveNode | null,
  requester: ImperativeClient = client,
): ShareReads {
  const grants = nodeGrants(nodeId, requester)
  const node = requester.query(api.drive.nodes.get, { node: nodeId, expand: 'access' })
  const early = canManage(known) ? grants.list() : null
  const list = node.then((fresh) => (canManage(fresh) ? (early ?? grants.list()) : null))
  // A dialog that never opens leaves these unread; whoever awaits them still sees a failure.
  for (const read of [node, early, list]) read?.catch(() => undefined)
  return { node, list }
}

/** Reads started for a dialog whose code is still loading. Older ones are stale. */
const started = new Map<string, { reads: ShareReads; at: number }>()
const FRESH_MS = 10_000

/** Starts the reads for a share dialog about to open, so they overlap loading its code. */
export function startShareReads(nodeId: string, known: DriveNode | null): void {
  started.set(nodeId, { reads: readShare(nodeId, known), at: Date.now() })
}

/** The reads `startShareReads` began for `nodeId`, once, while they are fresh. */
export function takeShareReads(nodeId: string): ShareReads | null {
  const entry = started.get(nodeId)
  started.delete(nodeId)
  return entry && Date.now() - entry.at < FRESH_MS ? entry.reads : null
}

let preloaded = false

/** Loads the dialog's code while the page is idle, so Share opens without waiting for it. */
export function preloadShareDialog(): void {
  if (preloaded || typeof window === 'undefined') return
  preloaded = true
  // A failed load is tried again when Share is chosen.
  const load = () =>
    void Promise.all([import('./present'), import('./ShareDialog.vue')]).catch(() => undefined)
  if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 3000 })
  else setTimeout(load, 1500)
}
