import { toValue, type MaybeRefOrGetter } from 'vue'

import { api, client } from '@/api'

import type { LobbyStore } from './useLobbyStore'

interface LobbyAPI {
  approveUser: (userId: string) => Promise<void>
  approveAllUsers: () => Promise<void>
  rejectUser: (userId: string) => Promise<void>
}

export function useLobby(deps: {
  lobbyStore: LobbyStore
  meetingId: MaybeRefOrGetter<string>
}): LobbyAPI {
  const { lobbyStore, meetingId } = deps

  const approveUser = async (userId: string) => {
    await client.mutation(api.meet.rooms.approve, { name: toValue(meetingId), user_id: userId })

    lobbyStore.removeLobbyUser(userId)
  }

  const approveAllUsers = async () => {
    await client.mutation(api.meet.rooms.approveAll, { name: toValue(meetingId) })

    lobbyStore.setLobbyUsers([])
  }

  const rejectUser = async (userId: string) => {
    await client.mutation(api.meet.rooms.reject, { name: toValue(meetingId), user_id: userId })

    lobbyStore.removeLobbyUser(userId)
  }

  return {
    approveUser,
    approveAllUsers,
    rejectUser,
  }
}
