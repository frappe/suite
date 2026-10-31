import { defineStore } from 'pinia'

import type { Participant, ParticipantUpdate } from '../utils/media/ParticipantManager'
import type { SharedStageState } from '../utils/sharedStage'

export const useParticipantStore = defineStore('meet-participant', {
  state: () => ({
    participants: {} as Record<string, Participant>,
    activeSpeakerIds: [] as string[],
    stableSpeakerIds: [] as string[],
    sharedStage: null as SharedStageState | null,
  }),
  actions: {
    // Only an authenticated join/rejoin snapshot may establish a new room epoch.
    applySharedStage(state: SharedStageState, snapshot = false) {
      if (this.sharedStage) {
        if (state.epoch !== this.sharedStage.epoch) {
          if (!snapshot) return
        } else if (state.version <= this.sharedStage.version) return
      }
      this.sharedStage = state
      this.activeSpeakerIds = [...state.activeSpeakerIds]
    },
    addParticipant(participant: Participant) {
      const userId = participant.user_id
      if (userId) this.participants[userId] = participant
    },
    removeParticipant(participantId: string) {
      delete this.participants[participantId]
    },
    updateParticipant(participantId: string, updates: ParticipantUpdate) {
      const participant = this.participants[participantId]
      if (participant) {
        this.participants[participantId] = { ...participant, ...updates }
      }
    },
    getParticipantName(participantId: string): string {
      return this.participants[participantId]?.user_name || participantId
    },
  },
})

export type ParticipantStore = ReturnType<typeof useParticipantStore>
