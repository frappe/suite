import type { AppContext } from 'vue'

import { presentDialog } from '../dialogHost'

/** Opens the share dialog for `node`. Resolves when it closes: `true` when a write in it went through. */
export async function presentShareDialog(node: string, context?: AppContext): Promise<boolean> {
  return (
    (await presentDialog<boolean>(
      context,
      () => import('./ShareDialog.vue'),
      { node },
      'changed',
    )) ?? false
  )
}
