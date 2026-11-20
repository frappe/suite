import { defineStore } from 'pinia'

export interface ChatMessage {
  id: number
  messageId?: string
  user_id: string
  user_name: string
  message: string
  timestamp: string
}

interface ChatState {
  isChatOpen: boolean
  chatMessages: ChatMessage[]
  hasUnreadMessages: boolean
  hostOnlyChat: boolean
  pinnedMessage: ChatMessage | null
}

export const useChatStore = defineStore('meet-chat', {
  state: (): ChatState => ({
    isChatOpen: false,
    chatMessages: [],
    hasUnreadMessages: false,
    hostOnlyChat: false,
    pinnedMessage: null,
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
      if (!this.chatMessages) this.chatMessages = []
      this.chatMessages.push(message)
    },
    setPinnedMessage(message: ChatMessage | null) {
      this.pinnedMessage = message
    },
  },
})

export type ChatStore = ReturnType<typeof useChatStore>
