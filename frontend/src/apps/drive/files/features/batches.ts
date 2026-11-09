import type { DriveBatchResult, DriveFailure } from '@/apps/drive/client/types'
import { TransportError } from '@/platform/transport'

/** The most nodes one Drive request may name. The server refuses more. */
export const MAX_BATCH_NODES = 200

/**
 * Sends `nodes` in requests of at most `size`, one after another, and merges
 * their results. A request that throws stops the rest. When it was the first,
 * the error is thrown, since nothing changed. Otherwise the nodes not changed
 * are reported as failed with its reason, so the caller announces only what
 * did change.
 */
export async function inBatches(
  nodes: readonly string[],
  send: (nodes: string[]) => Promise<DriveBatchResult>,
  size = MAX_BATCH_NODES,
): Promise<DriveBatchResult> {
  const merged: DriveBatchResult = { ok: [], failed: [] }
  for (let start = 0; start < nodes.length; start += size) {
    try {
      const result = await send(nodes.slice(start, start + size))
      merged.ok.push(...result.ok)
      merged.failed.push(...result.failed)
    } catch (cause) {
      if (start === 0) throw cause
      merged.failed.push(...nodes.slice(start).map((node) => refusal(node, cause)))
      break
    }
  }
  return merged
}

/** A node a failed request did not change, with the request's error as the reason. */
export function refusal(node: string, cause: unknown): DriveFailure {
  return {
    node,
    type: cause instanceof TransportError ? cause.type : 'Error',
    message: cause instanceof Error ? cause.message : 'The action failed.',
  }
}
