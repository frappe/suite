import { defineStore } from 'pinia'

interface RaiseHandState {
  raisedHands: Record<string, string>
}

export const useRaiseHandStore = defineStore('meet-raiseHand', {
  state: (): RaiseHandState => ({ raisedHands: {} }),
  getters: {
    isHandRaised: (state) => (userId: string) => !!state.raisedHands?.[userId],
  },
  actions: {
    setHands(hands: Record<string, string>) {
      this.raisedHands = hands
    },
    raiseHand(userId: string, timestamp: string) {
      this.raisedHands = { ...this.raisedHands, [userId]: timestamp }
    },
    lowerHand(userId: string) {
      const updated = { ...this.raisedHands }
      delete updated[userId]
      this.raisedHands = updated
    },
  },
})

export type RaiseHandStore = ReturnType<typeof useRaiseHandStore>
