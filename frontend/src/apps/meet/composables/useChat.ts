import { toast } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

import type { ChatQuote } from '../../../../../suite/meet/types'
import { E2EE_CHAT_PREFIX, MAX_CHAT_TEXT_BYTES } from '../../../../../suite/meet/types/chatLimits'
import {
  isChatReaction,
  type ChatReactionRequest,
  type ChatReactionsUpdated,
} from '../../../../../suite/meet/types/chatReactions'
import { isUnknownRecord } from '../types'
import audioNotificationManager from '../utils/audioNotifications'
import { E2EEMeeting } from '../utils/media/E2EEMeeting'
import { SFUResponseError, type SFUClient } from '../utils/SFUClient'
import type { ChatMessage, ChatStore } from './useChatStore'
import type { CurrentUser } from './useCurrentUser'

interface ChatAPI {
  setupChatEvents: (notify: (notification: ChatNotification) => void) => () => void
  onSendChat: (text: string, replyToId?: string) => Promise<boolean>
  setReaction: (data: ChatReactionRequest) => Promise<void>
  toggleRestriction: (enabled: boolean) => void
  pinMessage: (messageId: string, action?: 'pin' | 'unpin') => void
}

interface ChatNotification {
  message: string
  fromUser: string
  fromName: string
  type: 'chat'
}

interface IncomingChatMessage {
  fromUser: string
  fromName: string
  message: string
  timestamp: string
  messageId?: string
  replyTo?: ChatQuote
}

function normalizeChatMessage(value: unknown): IncomingChatMessage | null {
  if (
    !isUnknownRecord(value) ||
    typeof value.fromUser !== 'string' ||
    typeof value.message !== 'string'
  )
    return null
  const quote = value.replyTo
  const replyTo =
    isUnknownRecord(quote) &&
    typeof quote.messageId === 'string' &&
    typeof quote.fromName === 'string' &&
    typeof quote.message === 'string'
      ? { messageId: quote.messageId, fromName: quote.fromName, message: quote.message }
      : undefined
  return {
    replyTo,
    fromUser: value.fromUser,
    fromName: typeof value.fromName === 'string' ? value.fromName : value.fromUser,
    message: value.message,
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : new Date().toISOString(),
    messageId: typeof value.messageId === 'string' ? value.messageId : undefined,
  }
}

function normalizeReactionUpdate(value: unknown): ChatReactionsUpdated | null {
  if (
    !isUnknownRecord(value) ||
    typeof value.messageId !== 'string' ||
    !Array.isArray(value.reactions)
  )
    return null
  const reactions: ChatReactionsUpdated['reactions'] = []
  const rawReactions: unknown[] = value.reactions
  for (const reaction of rawReactions) {
    if (
      !isUnknownRecord(reaction) ||
      !isChatReaction(reaction.emoji) ||
      !Array.isArray(reaction.userIds)
    )
      return null
    const rawUserIds: unknown[] = reaction.userIds
    const userIds = rawUserIds.filter((id): id is string => typeof id === 'string')
    if (userIds.length) reactions.push({ emoji: reaction.emoji, userIds })
  }
  return { messageId: value.messageId, reactions }
}

function isEncryptedChatMessage(message: string): boolean {
  return message.startsWith(E2EE_CHAT_PREFIX)
}

async function encryptChatMessage(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(text)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted), iv.length)

  const binary = Array.from(combined)
    .map((b) => String.fromCharCode(b))
    .join('')
  return E2EE_CHAT_PREFIX + btoa(binary)
}

async function decryptChatMessage(key: CryptoKey, encryptedMessage: string): Promise<string> {
  const payload = encryptedMessage.slice(E2EE_CHAT_PREFIX.length)
  const binary = atob(payload)
  const combined = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    combined[i] = binary.charCodeAt(i)
  }

  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(decrypted)
}

function shouldEncryptChat(): boolean {
  return E2EEMeeting.instance.hasMeetingContext()
}

function isE2EERequired(sfuClient: SFUClient): boolean {
  return sfuClient.isE2EERequired?.() ?? false
}

export function useChat(deps: {
  chatStore: ChatStore
  currentUser: CurrentUser
  sfuClient: SFUClient
  canPin?: () => boolean
}): ChatAPI {
  const { chatStore, currentUser, sfuClient, canPin = () => false } = deps

  async function getChatKey(): Promise<CryptoKey | null> {
    return E2EEMeeting.instance.getE2EEChatKey()
  }

  async function resolvePlaintext(raw: string): Promise<string> {
    if (isEncryptedChatMessage(raw)) {
      const key = await getChatKey()
      if (!key) {
        console.warn('E2EE chat: received encrypted message but no meeting context set')
        return '[Encrypted message]'
      }
      try {
        return await decryptChatMessage(key, raw)
      } catch (e) {
        console.error('E2EE chat: decryption failed', e)
        const errName = e instanceof Error ? e.name : 'Error'
        return `[Encrypted: ${errName}]`
      }
    }
    if (isE2EERequired(sfuClient)) {
      return '[Unencrypted message blocked]'
    }
    return raw
  }

  async function decryptIfAvailable(key: CryptoKey, raw: string): Promise<string | null> {
    try {
      return await decryptChatMessage(key, raw)
    } catch {
      return null
    }
  }

  async function resolveQuote(quote: ChatQuote): Promise<ChatQuote> {
    if (!isEncryptedChatMessage(quote.message)) {
      return { ...quote, message: await resolvePlaintext(quote.message) }
    }

    const original = chatStore.chatMessages.find((item) => item.messageId === quote.messageId)
    if (
      original &&
      !original.message.startsWith('[Encrypted') &&
      original.message !== '[Unencrypted message blocked]'
    ) {
      return { ...quote, message: original.message }
    }

    const key = await getChatKey()
    const plaintext = key && (await decryptIfAvailable(key, quote.message))
    return { ...quote, message: plaintext ?? __('Earlier encrypted message unavailable') }
  }

  function toChatMessage(
    data: IncomingChatMessage,
    message: string,
    replyTo?: ChatQuote,
  ): ChatMessage {
    return {
      id: Date.now() + Math.random(),
      messageId: data.messageId,
      user_id: data.fromUser,
      user_name: data.fromName,
      message,
      replyTo,
      timestamp: data.timestamp,
    }
  }

  const setupChatEvents = (notify: (notification: ChatNotification) => void) => {
    let disposed = false
    const subscriptions = new Map<string, (value: unknown) => void>()
    function listen(event: string, handler: (value: unknown) => void) {
      subscriptions.set(event, handler)
      sfuClient.on(event, handler)
    }

    let pendingPinnedMessage: IncomingChatMessage | null = null
    let pinnedMessageUpdate = 0

    let snapshot: Map<string, IncomingChatMessage> | null = null
    let hydratingSnapshot: Map<string, IncomingChatMessage> | null = null
    let retrySnapshot = false
    const unavailableSnapshotIds = new Set<string>()
    const pendingLiveMessages = new Map<string, IncomingChatMessage>()

    function updateUnavailableHistory() {
      chatStore.hasUnavailableEncryptedHistory = unavailableSnapshotIds.size > 0
    }

    async function hydrateSnapshot() {
      const messages = snapshot
      if (!messages?.size) return
      if (hydratingSnapshot === messages) {
        retrySnapshot = true
        return
      }
      hydratingSnapshot = messages
      retrySnapshot = false
      try {
        for (const [id, data] of messages) {
          if (snapshot !== messages) return
          if (chatStore.chatMessages.some((item) => item.messageId === id)) {
            messages.delete(id)
            unavailableSnapshotIds.delete(id)
            continue
          }

          let plaintext: string | null
          if (isEncryptedChatMessage(data.message)) {
            const key = await getChatKey()
            if (!key) continue
            plaintext = await decryptIfAvailable(key, data.message)
          } else {
            plaintext = isE2EERequired(sfuClient) ? null : data.message
          }
          if (snapshot !== messages) return
          if (!messages.has(id)) continue
          if (plaintext === null) {
            unavailableSnapshotIds.add(id)
            continue
          }

          const replyTo = data.replyTo && (await resolveQuote(data.replyTo))
          if (snapshot !== messages) return
          if (!messages.delete(id)) continue
          unavailableSnapshotIds.delete(id)
          chatStore.addMessage(toChatMessage(data, plaintext, replyTo))
        }
        updateUnavailableHistory()
      } finally {
        if (hydratingSnapshot === messages) {
          hydratingSnapshot = null
          if (retrySnapshot && snapshot === messages) void hydrateSnapshot()
        }
      }
    }

    listen('chat:snapshot', (value: unknown) => {
      if (
        !isUnknownRecord(value) ||
        !Array.isArray(value.messages) ||
        !Array.isArray(value.reactions)
      )
        return
      const messages = new Map<string, IncomingChatMessage>()
      const rawMessages: unknown[] = value.messages
      for (const raw of rawMessages) {
        const message = normalizeChatMessage(raw)
        if (message?.messageId) messages.set(message.messageId, message)
      }
      const pinnedId = typeof value.pinnedId === 'string' ? value.pinnedId : null
      snapshot = messages
      unavailableSnapshotIds.clear()
      updateUnavailableHistory()
      pendingLiveMessages.clear()
      chatStore.chatMessages = chatStore.chatMessages.filter(
        ({ messageId }) => messageId && (messages.has(messageId) || messageId === pinnedId),
      )
      chatStore.reactionsByMessage = {}
      const rawReactions: unknown[] = value.reactions
      for (const raw of rawReactions) {
        const update = normalizeReactionUpdate(raw)
        if (update) chatStore.setReactions(update)
      }
      chatStore.expiredPinnedMessageId = value.pinnedRetained === false ? pinnedId : null
      chatStore.hostOnlyChat = value.hostOnlyChat === true
      void hydrateSnapshot()
    })

    listen('chat:message_evicted', (value: unknown) => {
      if (!isUnknownRecord(value) || typeof value.messageId !== 'string') return
      snapshot?.delete(value.messageId)
      if (unavailableSnapshotIds.delete(value.messageId)) updateUnavailableHistory()
      pendingLiveMessages.delete(value.messageId)
      chatStore.evictMessage(value.messageId)
    })

    async function receiveLiveMessage(data: IncomingChatMessage) {
      let plaintext: string
      if (isEncryptedChatMessage(data.message) && data.messageId) {
        const key = await getChatKey()
        if (!key || disposed) return
        const decrypted = await decryptIfAvailable(key, data.message)
        if (decrypted === null) return
        plaintext = decrypted
      } else {
        plaintext = await resolvePlaintext(data.message)
      }
      if (disposed) return
      const replyTo = data.replyTo && (await resolveQuote(data.replyTo))
      if (disposed) return
      if (data.messageId) {
        if (pendingLiveMessages.get(data.messageId) !== data) return
        pendingLiveMessages.delete(data.messageId)
      }

      const message = toChatMessage(data, plaintext, replyTo)
      chatStore.addMessage(message)
      if (!chatStore.isChatOpen) {
        chatStore.hasUnreadMessages = true
        notify({
          message: message.message,
          fromUser: data.fromUser,
          fromName: data.fromName,
          type: 'chat',
        })
        audioNotificationManager.playChatNotification()
      }
    }

    listen('chat:message', (value: unknown) => {
      const data = normalizeChatMessage(value)
      if (!data || data.fromUser === currentUser.currentUser.value?.user_id) return
      if (data.messageId) pendingLiveMessages.set(data.messageId, data)
      void receiveLiveMessage(data)
    })

    const applyPinnedMessage = async (value: unknown) => {
      const update = ++pinnedMessageUpdate
      if (!isUnknownRecord(value) || value.pinned == null) {
        pendingPinnedMessage = null
        chatStore.setPinnedMessage(null)
        return
      }
      const data = normalizeChatMessage(value.pinned)
      if (!data) return
      pendingPinnedMessage = data
      if (isEncryptedChatMessage(data.message) && !(await getChatKey())) return
      const plaintext = await resolvePlaintext(data.message)
      if (isEncryptedChatMessage(data.message) && plaintext.startsWith('[Encrypted')) {
        return
      }
      const replyTo = data.replyTo && (await resolveQuote(data.replyTo))
      const message = toChatMessage(data, plaintext, replyTo)
      if (update !== pinnedMessageUpdate) return
      if (
        message.messageId &&
        !chatStore.chatMessages.some((existing) => existing.messageId === message.messageId)
      ) {
        chatStore.addMessage(message)
      }
      chatStore.setPinnedMessage(message)
      pendingPinnedMessage = null
    }

    listen('chat:pin_updated', applyPinnedMessage)
    listen('existing_pinned_message', applyPinnedMessage)
    function onContextReady() {
      void hydrateSnapshot()
      for (const message of pendingLiveMessages.values()) void receiveLiveMessage(message)
      if (pendingPinnedMessage) {
        void applyPinnedMessage({ pinned: pendingPinnedMessage })
      }
      if (canPin() && chatStore.pinnedMessage?.messageId) {
        void pinMessage(chatStore.pinnedMessage.messageId)
      }
    }
    document.addEventListener('meet:e2ee-context-ready', onContextReady)
    listen('chat:reactions_updated', (value: unknown) => {
      const update = normalizeReactionUpdate(value)
      if (update) chatStore.setReactions(update)
    })

    listen('chat:restriction_updated', (value: unknown) => {
      if (isUnknownRecord(value) && typeof value.enabled === 'boolean') {
        chatStore.hostOnlyChat = value.enabled
      }
    })

    listen('sfu_error', (value: unknown) => {
      if (isUnknownRecord(value) && value.code === 'HOST_ONLY_CHAT') {
        toast.error(
          __('Could not send the message. The host restricted chat to hosts and co-hosts.'),
        )
        chatStore.hostOnlyChat = true
      }
    })
    return () => {
      disposed = true
      snapshot = null
      hydratingSnapshot = null
      pinnedMessageUpdate++
      pendingPinnedMessage = null
      pendingLiveMessages.clear()
      unavailableSnapshotIds.clear()
      document.removeEventListener('meet:e2ee-context-ready', onContextReady)
      for (const [event, handler] of subscriptions) sfuClient.off(event, handler)
      subscriptions.clear()
    }
  }

  const toggleRestriction = (enabled: boolean) => {
    if (sfuClient.isConnected()) {
      sfuClient.sendEvent('chat:toggle_restriction', { enabled })
    }
  }

  const onSendChat = async (text: string, replyToId?: string) => {
    if (new TextEncoder().encode(text).length > MAX_CHAT_TEXT_BYTES) {
      toast.error(__('This message is too long. Shorten it and try again.'))
      return false
    }
    const original =
      replyToId && chatStore.chatMessages.find((message) => message.messageId === replyToId)
    const replyTo =
      original && original.messageId
        ? { messageId: original.messageId, fromName: original.user_name, message: original.message }
        : undefined

    try {
      let messageToSend = text
      if (isE2EERequired(sfuClient) || shouldEncryptChat()) {
        const key = await getChatKey()
        if (!key) {
          toast.error(
            __('Could not send the message. Wait for encryption to finish, then try again.'),
          )
          return false
        }
        messageToSend = await encryptChatMessage(key, text)
      }

      const { timestamp, messageId } = await sfuClient.sendChatMessage(messageToSend, {
        clientId: currentUser.currentUser.value?.user_id,
        replyToId,
      })

      const message: ChatMessage = {
        id: Date.now() + Math.random(),
        messageId,
        user_id: currentUser.currentUser.value?.user_id ?? '',
        user_name:
          currentUser.currentUser.value?.full_name ||
          currentUser.currentUser.value?.name ||
          currentUser.currentUser.value?.user_id ||
          '',
        message: text,
        replyTo,
        timestamp,
      }
      chatStore.addMessage(message)
      return true
    } catch (error) {
      console.error('Failed to send chat message:', error)
      toast.error(
        replyToId && error instanceof SFUResponseError
          ? error.message
          : __('Could not send the message'),
      )
      return false
    }
  }

  const pendingReactions = new Set<string>()
  const setReaction = async (data: ChatReactionRequest) => {
    const key = `${data.messageId}:${data.emoji}`
    if (pendingReactions.has(key)) return
    pendingReactions.add(key)
    try {
      await sfuClient.setChatReaction(data)
    } catch (error) {
      toast.error(
        error instanceof SFUResponseError
          ? error.message
          : __('Failed to update reaction. Try again.'),
      )
    } finally {
      pendingReactions.delete(key)
    }
  }

  const pinMessage = async (messageId: string, action: 'pin' | 'unpin' = 'pin') => {
    try {
      if (sfuClient.isConnected()) {
        let encryptedMessage: string | undefined
        if (action === 'pin' && shouldEncryptChat()) {
          const message = chatStore.chatMessages.find((item) => item.messageId === messageId)
          const key = await getChatKey()
          if (message && key && !isEncryptedChatMessage(message.message)) {
            encryptedMessage = await encryptChatMessage(key, message.message)
          }
        }
        await sfuClient.sendChatPin(messageId, action, encryptedMessage)
      }
    } catch (error) {
      console.error('Failed to pin chat message:', error)
      toast.error(__('Could not pin the message'))
    }
  }

  return {
    setupChatEvents,
    toggleRestriction,
    onSendChat,
    setReaction,
    pinMessage,
  }
}
