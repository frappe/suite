import { computed, getCurrentInstance, ref } from 'vue'

import { batchNodes, node, purgeNodes } from '@/apps/drive/client/nodes'
import { emptyTrash } from '@/apps/drive/client/roots'
import { DRIVE_ROLES, hasRole, type DriveBatchResult } from '@/apps/drive/client/types'
import { confirm, toast } from '@/platform/feedback'
import { useMutation, useQuery } from '@/platform/server-state'
import type { PlatformError } from '@/platform/transport'

import { presentDialog } from '../dialogHost'

const DESTINATION_REQUIRED = 'DriveRestoreDestinationRequired'

/**
 * Restore, Delete forever and Empty trash for one root's Trash (spec §7).
 * `root` is the root node the Trash view shows. Batch results land in
 * `outcome` with their verb, for `BatchOutcome`.
 */
export function useTrashActions(root: () => string | null) {
  const context = getCurrentInstance()!.appContext
  const outcome = ref<DriveBatchResult | null>(null)
  const verb = ref('')
  // Silent: a failed request gets a toast with Retry below, not the default one.
  const restoring = useMutation(batchNodes(), { silent: true })
  const purging = useMutation(purgeNodes(), { silent: true })
  const emptying = useMutation(emptyTrash(), { silent: true })
  const rootDetail = useQuery(() => {
    const id = root()
    return id ? node(id, 'access') : false
  })
  /** Empty trash deletes other people's items too, so it needs MANAGE on the root. */
  const canEmptyTrash = computed(() => hasRole(rootDetail.data, DRIVE_ROLES.manage))
  const pending = computed(() => restoring.isPending || purging.isPending || emptying.isPending)

  /**
   * Restores to where each item was. Items whose folder is gone come back
   * with `DriveRestoreDestinationRequired`; the user picks one folder in the
   * same root for all of them. Cancel leaves them in Trash.
   */
  async function restore(nodes: readonly string[]): Promise<DriveBatchResult | null> {
    const first = await restoring.run({ nodes: [...nodes], patch: { state: 'Active' } })
    if (!first) {
      offerRetry(restoring.error, () => restore(nodes))
      return null
    }
    show(first, 'restored')
    const homeless = first.failed.filter((failure) => failure.type === DESTINATION_REQUIRED)
    const rootId = root()
    if (!homeless.length || !rootId) return first
    const parent = await presentDialog<string>(
      context,
      () => import('./RestoreDestinationDialog.vue'),
      { root: rootId, count: homeless.length },
      'choose',
    )
    // Cancel leaves them in Trash, listed as failed in the outcome.
    if (!parent) return first
    return restoreInto(first, homeless.map((failure) => failure.node), parent)
  }

  /** The second restore: items whose folder is gone, into the folder the user picked. */
  async function restoreInto(first: DriveBatchResult, nodes: string[], parent: string): Promise<DriveBatchResult | null> {
    const second = await restoring.run({ nodes, patch: { state: 'Active', parent } })
    if (!second) {
      offerRetry(restoring.error, () => restoreInto(first, nodes, parent))
      return null
    }
    const result = {
      ok: [...first.ok, ...second.ok],
      failed: [...first.failed.filter((failure) => failure.type !== DESTINATION_REQUIRED), ...second.failed],
    }
    show(result, 'restored')
    return result
  }

  async function purge(nodes: readonly string[]): Promise<DriveBatchResult | null> {
    const agreed = await confirm({
      title: nodes.length === 1 ? 'Delete forever?' : `Delete ${nodes.length} items forever?`,
      message: 'You cannot undo this.',
      confirmLabel: 'Delete forever',
      destructive: true,
    })
    if (!agreed) return null
    return runPurge(nodes)
  }

  async function runPurge(nodes: readonly string[]): Promise<DriveBatchResult | null> {
    const result = await purging.run({ nodes: [...nodes] })
    if (!result) {
      offerRetry(purging.error, () => runPurge(nodes))
      return null
    }
    show(result, 'deleted forever')
    return result
  }

  async function emptyAll(): Promise<number | null> {
    const rootId = root()
    if (!rootId || !canEmptyTrash.value) return null
    const agreed = await confirm({
      title: 'Empty trash?',
      message: 'Delete everything in Trash forever? You cannot undo this.',
      confirmLabel: 'Empty trash',
      destructive: true,
    })
    if (!agreed) return null
    return runEmpty(rootId)
  }

  async function runEmpty(rootId: string): Promise<number | null> {
    const result = await emptying.run({ root: rootId })
    if (!result) {
      offerRetry(emptying.error, () => runEmpty(rootId))
      return null
    }
    outcome.value = null
    toast.success(result.purged === 1 ? '1 item deleted forever' : `${result.purged} items deleted forever`)
    return result.purged
  }

  /** A whole request failed. Retry sends the same request, with no new questions. */
  function offerRetry(error: PlatformError | null, again: () => unknown) {
    toast.error(error?.message ?? 'The request failed.', {
      duration: 10_000,
      action: { label: 'Retry', onClick: () => void again() },
    })
  }

  function show(result: DriveBatchResult, nextVerb: string) {
    outcome.value = result
    verb.value = nextVerb
  }

  return {
    outcome,
    verb,
    pending,
    canEmptyTrash,
    restore,
    purge,
    emptyTrash: emptyAll,
    dismissOutcome: () => {
      outcome.value = null
    },
  }
}
