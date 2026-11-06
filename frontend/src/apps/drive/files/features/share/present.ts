import type { AppContext } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'

import { presentDialog } from '../dialogHost'

/**
 * Opens the share dialog for `node`. Resolves when it closes: `true` when a
 * write in it went through. `known` is the node as the opener last read it.
 */
export async function presentShareDialog(
  node: string,
  context?: AppContext,
  known?: DriveNode,
): Promise<boolean> {
  return (
    (await presentDialog<boolean>(
      context,
      () => import('./ShareDialog.vue'),
      known ? { node, known } : { node },
      'changed',
    )) ?? false
  )
}
