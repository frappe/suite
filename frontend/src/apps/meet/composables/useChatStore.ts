import { defineStore } from 'pinia'

import type { ChatQuote } from '../../../../../suite/meet/types'
import type { ChatReactionsUpdated } from '../../../../../suite/meet/types/chatReactions'

export interface ChatMessage {
  id: string | number
  messageId?: string
  replyTo?: ChatQuote
  user_id: string
  user_name: string
  message: string
  timestamp: string
}

interface ChatState {
  isChatOpen: boolean
  chatMessages: ChatMessage[]
  hasUnreadMessages: boolean
  hasUnavailableEncryptedHistory: boolean
  reactionsByMessage: Record<string, ChatReactionsUpdated['reactions']>
  expiredPinnedMessageId: string | null
  hostOnlyChat: boolean
  pinnedMessage: ChatMessage | null
}

export const useChatStore = defineStore('meet-chat', {
  state: (): ChatState => ({
    isChatOpen: false,
    chatMessages: [],
    hasUnreadMessages: false,
    hasUnavailableEncryptedHistory: false,
    reactionsByMessage: {},
    hostOnlyChat: false,
    pinnedMessage: null,
    expiredPinnedMessageId: null,
  }),
  actions: {
    toggleChat() {
      this.isChatOpen = !this.isChatOpen
      if (this.isChatOpen) this.hasUnreadMessages = false
    },
    markAsRead() {
      this.hasUnreadMessages = false
    },
    addMessage(message: ChatMessage) {
      if (
        message.messageId &&
        this.chatMessages.some((item) => item.messageId === message.messageId)
      )
        return
      this.chatMessages.push(message)
    },
    setReactions({ messageId, reactions }: ChatReactionsUpdated) {
      if (reactions.length) this.reactionsByMessage[messageId] = reactions
      else delete this.reactionsByMessage[messageId]
    },
    evictMessage(messageId: string) {
      delete this.reactionsByMessage[messageId]
      if (this.pinnedMessage?.messageId === messageId) {
        this.expiredPinnedMessageId = messageId
      } else {
        this.chatMessages = this.chatMessages.filter((item) => item.messageId !== messageId)
      }
    },
    setPinnedMessage(message: ChatMessage | null) {
      if (this.expiredPinnedMessageId && this.expiredPinnedMessageId !== message?.messageId) {
        this.chatMessages = this.chatMessages.filter(
          (item) => item.messageId !== this.expiredPinnedMessageId,
        )
        this.expiredPinnedMessageId = null
      }
      this.pinnedMessage = message
    },
  },
})

export type ChatStore = ReturnType<typeof useChatStore>
