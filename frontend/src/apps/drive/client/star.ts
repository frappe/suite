import { computed, ref } from 'vue'

import { api } from '@/api'
import type { ImperativeClient } from '@/platform/server-state/types'

/** The caller's own star on one node. A refused change shows its toast and puts the old state back. */
export function createStar(
  requester: ImperativeClient,
  node: string,
  starred: boolean,
  isAllowed: () => boolean,
  signal: AbortSignal,
) {
  const isStarred = ref(starred)
  return {
    isStarred,
    canStar: computed(isAllowed),
    async setStarred(next: boolean) {
      isStarred.value = next
      const operation = next ? api.drive.nodes.star : api.drive.nodes.unstar
      try {
        await requester.mutation(operation, { node }, { signal })
      } catch {
        isStarred.value = !next
      }
    },
  }
}
