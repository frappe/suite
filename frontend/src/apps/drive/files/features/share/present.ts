import type { AppContext } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'

import { presentDialog } from '../dialogHost'
import type { ShareReads } from './opening'

/**
 * Opens the share dialog for `node`. Resolves when it closes: `true` when a
 * write in it went through. `known` is the node as the opener last read it,
 * and `reads` the reads the opener already started for it.
 */
export async function presentShareDialog(
  node: string,
  context?: AppContext,
  known?: DriveNode,
  reads?: ShareReads,
): Promise<boolean> {
  return (
    (await presentDialog<boolean>(
      context,
      () => import('./ShareDialog.vue'),
      { node, known, reads },
      'changed',
    )) ?? false
  )
}
