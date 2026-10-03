import { ref } from 'vue'

export type CollaborationUser = Record<string, unknown> & {
  clientId: number
  id?: string
  name?: string
  avatar?: string
  color?: string
}

type CollaborationAwareness = {
  /** This connection's own client, left out of `peers`. */
  clientID: number
  getStates: () => Map<number, { user?: Record<string, unknown> } | null | undefined>
  on: (event: 'update', listener: () => void) => void
  off: (event: 'update', listener: () => void) => void
}

/**
 * The other people editing this document. This connection is left out, and a
 * person connected from several tabs is listed once.
 */
export function useCollaborationUsers(awareness: CollaborationAwareness) {
  const peers = ref<CollaborationUser[]>([])

  const syncPeers = () => {
    const seen = new Set<unknown>()
    const next: CollaborationUser[] = []
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID || !state?.user) continue
      const user: CollaborationUser = { clientId, ...state.user }
      const key = user.id ?? clientId
      if (seen.has(key)) continue
      seen.add(key)
      next.push(user)
    }
    peers.value = next
  }

  awareness.on('update', syncPeers)
  syncPeers()

  const cleanup = () => {
    awareness.off('update', syncPeers)
    peers.value = []
  }

  return { peers, cleanup }
}
