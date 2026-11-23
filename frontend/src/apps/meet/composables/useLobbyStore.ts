import { defineStore } from 'pinia'

interface LobbyUser {
  userId: string
  name: string
  avatar?: string
  requested_at?: string
  isGuest?: boolean
}

interface LobbyState {
  isWaitingForApproval: boolean
  isJoinRequestRejected: boolean
  lobbyUsers: LobbyUser[]
  isInLobby: boolean
}

export const useLobbyStore = defineStore('meet-lobby', {
  state: (): LobbyState => ({
    isWaitingForApproval: false,
    isJoinRequestRejected: false,
    lobbyUsers: [],
    isInLobby: false,
  }),
  actions: {
    setLobbyUsers(users: LobbyUser[]) {
      this.lobbyUsers = users
    },
    addLobbyUser(user: LobbyUser) {
      const current = this.lobbyUsers || []
      if (!current.some((candidate) => candidate.userId === user.userId)) {
        this.lobbyUsers = [...current, user]
      }
    },
    removeLobbyUser(userId: string) {
      this.lobbyUsers = (this.lobbyUsers || []).filter((user) => user.userId !== userId)
    },
  },
})

export type LobbyStore = ReturnType<typeof useLobbyStore>
