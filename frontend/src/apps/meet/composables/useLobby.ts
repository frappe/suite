import { toast } from 'frappe-ui'
import { toValue, type MaybeRefOrGetter } from 'vue'

import { api, client } from '@/api'

import { getErrorMessage } from '../utils/error'
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
    try {
      await client.mutation(
        api.meet.rooms.approve,
        { name: toValue(meetingId), user_id: userId },
        { silent: true },
      )

      lobbyStore.removeLobbyUser(userId)
    } catch (error) {
      console.error('Failed to approve user:', error)
      toast.error(getErrorMessage(error))
    }
  }

  const approveAllUsers = async () => {
    try {
      await client.mutation(
        api.meet.rooms.approveAll,
        { name: toValue(meetingId) },
        { silent: true },
      )

      lobbyStore.setLobbyUsers([])
    } catch (error) {
      console.error('Failed to approve all users:', error)
      toast.error(getErrorMessage(error))
    }
  }

  const rejectUser = async (userId: string) => {
    try {
      await client.mutation(
        api.meet.rooms.reject,
        { name: toValue(meetingId), user_id: userId },
        { silent: true },
      )

      lobbyStore.removeLobbyUser(userId)
    } catch (error) {
      console.error('Failed to reject user:', error)
      toast.error(getErrorMessage(error))
    }
  }

  return {
    approveUser,
    approveAllUsers,
    rejectUser,
  }
}
