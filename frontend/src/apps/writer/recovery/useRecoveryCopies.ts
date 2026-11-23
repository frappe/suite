import { shallowRef } from 'vue'

import { listCopies, type RecoveryCopy } from './copies'

/** This device's recovery copies, of one document when `node` is given, read again on `refresh`. */
export function useRecoveryCopies(node?: string) {
  const copies = shallowRef<RecoveryCopy[]>([])

  async function refresh() {
    copies.value = await listCopies(node)
  }

  return { copies, refresh }
}
