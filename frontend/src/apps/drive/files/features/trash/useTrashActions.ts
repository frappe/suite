import { computed, getCurrentInstance, ref } from 'vue'

import { batchNodes, node, purgeNodes } from '@/apps/drive/client/nodes'
import { emptyTrash } from '@/apps/drive/client/roots'
import { DRIVE_ROLES, hasRole, type DriveBatchResult } from '@/apps/drive/client/types'
import { confirm, toast } from '@/platform/feedback'
import { useMutation, useQuery } from '@/platform/server-state'

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
  const restoring = useMutation(batchNodes())
  const purging = useMutation(purgeNodes())
  const emptying = useMutation(emptyTrash())
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
    if (!first) return null
    const homeless = first.failed.filter((failure) => failure.type === DESTINATION_REQUIRED)
    const rootId = root()
    let result = first
    if (homeless.length && rootId) {
      const parent = await presentDialog<string>(
        context,
        () => import('./RestoreDestinationDialog.vue'),
        { root: rootId, count: homeless.length },
        'choose',
      )
      if (parent) {
        const second = await restoring.run({
          nodes: homeless.map((failure) => failure.node),
          patch: { state: 'Active', parent },
        })
        if (second) {
          result = {
            ok: [...first.ok, ...second.ok],
            failed: [...first.failed.filter((failure) => failure.type !== DESTINATION_REQUIRED), ...second.failed],
          }
        }
      }
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
    const result = await purging.run({ nodes: [...nodes] })
    if (result) show(result, 'deleted forever')
    return result ?? null
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
    const result = await emptying.run({ root: rootId })
    if (!result) return null
    outcome.value = null
    toast.success(result.purged === 1 ? '1 item deleted forever' : `${result.purged} items deleted forever`)
    return result.purged
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
