import type { AppContext } from 'vue'

import { presentDialog } from '../dialogHost'

/** Opens the share dialog for `node`. Resolves when it closes. */
export async function presentShareDialog(node: string, context?: AppContext): Promise<void> {
  await presentDialog(context, () => import('./ShareDialog.vue'), { node })
}
