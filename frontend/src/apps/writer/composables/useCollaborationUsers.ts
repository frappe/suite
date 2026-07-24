import { ref } from 'vue'

export type CollaborationUser = Record<string, unknown> & {
  clientId: number
  id?: string
  name?: string
  avatar?: string
  color?: string
}

type CollaborationAwareness = {
  getStates: () => Map<
    number,
    { user?: Record<string, unknown> } | null | undefined
  >
  on: (event: 'update', listener: () => void) => void
  off: (event: 'update', listener: () => void) => void
}

export function useCollaborationUsers(awareness: CollaborationAwareness) {
  const users = ref<CollaborationUser[]>([])

  const syncUsers = () => {
    users.value = Array.from(awareness.getStates(), ([clientId, state]) =>
      state?.user ? { clientId, ...state.user } : null,
    ).filter((user): user is CollaborationUser => user !== null)
  }

  awareness.on('update', syncUsers)
  syncUsers()

  const cleanup = () => {
    awareness.off('update', syncUsers)
    users.value = []
  }

  return { users, cleanup }
}
