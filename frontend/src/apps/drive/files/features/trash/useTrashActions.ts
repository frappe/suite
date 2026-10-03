import { computed, getCurrentInstance, ref } from 'vue'

import { batchNodes, node, purgeNodes } from '@/apps/drive/client/nodes'
import { emptyTrash } from '@/apps/drive/client/roots'
import { DRIVE_ROLES, hasRole, type DriveBatchResult } from '@/apps/drive/client/types'
import { confirm, toast } from '@/platform/feedback'
import { useMutation, useQuery } from '@/platform/server-state'
import type { PlatformError } from '@/platform/transport'

import { presentDialog } from '../dialogHost'
import { announceRestore, subject, type ChangedItem } from '../changeToast'

const DESTINATION_REQUIRED = 'DriveRestoreDestinationRequired'

/**
 * Restore, Delete forever and Empty trash for one root's Trash (spec §7).
 * `root` is the root the items belong to; a restored item whose folder is gone
 * goes to a folder the user picks in it. What worked is reported in a toast,
 * with Undo for a restore. Each batch result also lands in `outcome` with its
 * verb, for `BatchOutcome`, which lists any failures.
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
  async function restore(items: readonly ChangedItem[]): Promise<DriveBatchResult | null> {
    const first = await restoring.run({ nodes: items.map((item) => item.node), patch: { state: 'Active' } })
    if (!first) {
      offerRetry(restoring.error, () => restore(items))
      return null
    }
    const homeless = first.failed.filter((failure) => failure.type === DESTINATION_REQUIRED)
    const rootId = root()
    if (!homeless.length || !rootId) return reportRestore(items, first)
    const parent = await presentDialog<string>(
      context,
      () => import('./RestoreDestinationDialog.vue'),
      { root: rootId, count: homeless.length },
      'choose',
    )
    // Cancel leaves them in Trash, listed as failed in the outcome.
    if (!parent) return reportRestore(items, first)
    return restoreInto(items, first, homeless.map((failure) => failure.node), parent)
  }

  /** The second restore: items whose folder is gone, into the folder the user picked. */
  async function restoreInto(
    items: readonly ChangedItem[],
    first: DriveBatchResult,
    nodes: string[],
    parent: string,
  ): Promise<DriveBatchResult | null> {
    const second = await restoring.run({ nodes, patch: { state: 'Active', parent_node: parent } })
    if (!second) {
      offerRetry(restoring.error, () => restoreInto(items, first, nodes, parent))
      return null
    }
    return reportRestore(items, {
      ok: [...first.ok, ...second.ok],
      failed: [...first.failed.filter((failure) => failure.type !== DESTINATION_REQUIRED), ...second.failed],
    })
  }

  /** A toast with Undo names what came back. The alert stays only to list failures. */
  function reportRestore(items: readonly ChangedItem[], result: DriveBatchResult): DriveBatchResult {
    announceRestore(items.filter((item) => result.ok.includes(item.node)))
    show(result, 'restored')
    return result
  }

  async function purge(items: readonly ChangedItem[]): Promise<DriveBatchResult | null> {
    const agreed = await confirm({
      title: items.length === 1 ? 'Delete forever?' : `Delete ${items.length} items forever?`,
      message: 'You cannot undo this.',
      confirmLabel: 'Delete forever',
      destructive: true,
    })
    if (!agreed) return null
    return runPurge(items)
  }

  /** Deleting forever cannot be undone, so its toast offers no Undo. */
  async function runPurge(items: readonly ChangedItem[]): Promise<DriveBatchResult | null> {
    const result = await purging.run({ nodes: items.map((item) => item.node) })
    if (!result) {
      offerRetry(purging.error, () => runPurge(items))
      return null
    }
    const deleted = items.filter((item) => result.ok.includes(item.node))
    if (deleted.length) toast.success(`Deleted ${subject(deleted)} forever`)
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
    toast.success(result.count === 1 ? 'Deleted 1 item forever' : `Deleted ${result.count} items forever`)
    return result.count
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
