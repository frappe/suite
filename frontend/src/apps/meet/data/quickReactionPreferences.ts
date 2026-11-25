import { useStorage } from '@vueuse/core'
import { readonly } from 'vue'

import { isChatReaction, QUICK_CHAT_REACTIONS } from '../../../../../suite/meet/types/chatReactions'

const defaults = QUICK_CHAT_REACTIONS.slice(0, 3)
const preferences = useStorage<string[]>('meet.quickReactions', defaults.slice(), undefined, {
  serializer: {
    read(value) {
      try {
        const emojis: unknown = JSON.parse(value)
        if (
          Array.isArray(emojis) &&
          emojis.length === defaults.length &&
          emojis.every(isChatReaction) &&
          new Set(emojis).size === emojis.length
        ) {
          return emojis
        }
      } catch {
        return defaults.slice()
      }
      return defaults.slice()
    },
    write: JSON.stringify,
  },
})

export const quickReactions = readonly(preferences)

export function setQuickReaction(slot: number, emoji: string) {
  const previous = preferences.value[slot]
  if (!previous || !isChatReaction(emoji) || previous === emoji) return

  const next = preferences.value.slice()
  const existingSlot = next.indexOf(emoji)
  if (existingSlot !== -1) next[existingSlot] = previous
  next[slot] = emoji
  preferences.value = next
}

export function resetQuickReactions() {
  preferences.value = defaults.slice()
}
