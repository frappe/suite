import { webcrypto } from 'node:crypto'
import { fromPartial } from '@total-typescript/shoehorn'
import { toast } from 'frappe-ui'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { E2EEMeeting } from '../../utils/media/E2EEMeeting'
import { useChat } from '../useChat'
import { useChatStore, type ChatMessage, type ChatStore } from '../useChatStore'

vi.mock('frappe-ui', () => ({
  toast: { error: vi.fn() },
}))

vi.mock('../../utils/audioNotifications', () => ({
  default: { playChatNotification: vi.fn() },
}))

function makeChatStore(): ChatStore {
  const messages: ChatMessage[] = []
  return fromPartial<ChatStore>({
    isChatOpen: true,
    chatMessages: messages,
    hasUnreadMessages: false,
    hostOnlyChat: false,
    pinnedMessage: null,
    setPinnedMessage: vi.fn(),
    toggleChat: vi.fn(),
    markAsRead: vi.fn(),
    addMessage: vi.fn((message: ChatMessage) => messages.push(message)),
    $reset: vi.fn(),
  })
}

function makeSFUClient(
  overrides: Partial<{
    isE2EERequired: () => boolean
    sendChatMessage: (message: string) => Promise<{
      success: boolean
      timestamp: string
      messageId?: string
    }>
  }> = {},
) {
  const handlers = new Map<string, (data: unknown) => void>()
  return {
    on: vi.fn((event: string, handler: (data: unknown) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn((event: string, handler: (data: unknown) => void) => {
      if (handlers.get(event) === handler) handlers.delete(event)
    }),
    isConnected: vi.fn(() => true),
    isE2EERequired: vi.fn(() => true),
    sendChatMessage: vi.fn(),
    sendChatPin: vi.fn(),
    emitSnapshot: (data: unknown) => handlers.get('chat:snapshot')?.(data),
    emitChatMessage: (data: unknown) => handlers.get('chat:message')?.(data),
    emitPinUpdated: (data: unknown) => handlers.get('chat:pin_updated')?.(data),
    emitExistingPinned: (data: unknown) => handlers.get('existing_pinned_message')?.(data),
    ...overrides,
  }
}

const currentUser = {
  currentUser: {
    value: {
      user_id: 'alice@example.com',
      full_name: 'Alice',
      name: 'Alice',
    },
  },
}

async function cipher(key: CryptoKey, text: string) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  )
  return 'e2ee:' + Buffer.concat([iv, Buffer.from(encrypted)]).toString('base64')
}

describe('useChat reconnect', () => {
  it('restores missed chat and replaces stale reaction counts without notifying or duplicating messages', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = useChatStore(createPinia())
    const sfuClient = makeSFUClient({ isE2EERequired: () => false })
    const notify = vi.fn()
    useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    }).setupChatEvents(notify)

    const original = { messageId: 'm1', message: 'Original', fromUser: 'bob', fromName: 'Bob' }
    chatStore.addMessage({
      id: 1,
      messageId: 'm1',
      message: 'Original',
      user_id: 'bob',
      user_name: 'Bob',
      timestamp: '2026-11-24T12:00:00Z',
    })
    chatStore.setReactions({ messageId: 'm1', reactions: [{ emoji: '👍', userIds: ['alice'] }] })
    sfuClient.emitSnapshot({
      messages: [
        original,
        {
          messageId: 'm2',
          message: 'Reply while you were away',
          fromUser: 'bob',
          fromName: 'Bob',
          replyTo: original,
        },
      ],
      reactions: [{ messageId: 'm2', reactions: [{ emoji: '❤️', userIds: ['bob'] }] }],
      pinnedId: null,
      pinnedRetained: false,
      hostOnlyChat: true,
    })

    await vi.waitFor(() =>
      expect(chatStore.chatMessages.map(({ messageId }) => messageId)).toEqual(['m1', 'm2']),
    )
    expect(chatStore.chatMessages[1]?.replyTo?.message).toBe('Original')
    expect(chatStore.reactionsByMessage).toEqual({ m2: [{ emoji: '❤️', userIds: ['bob'] }] })
    expect(chatStore.hostOnlyChat).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })

  it('restores only readable encrypted history and retries when the meeting key becomes available', async () => {
    const oldKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const currentKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])

    const oldMessage = await cipher(oldKey, 'Older private message')
    const newMessage = await cipher(currentKey, 'Readable reply')
    E2EEMeeting.instance = new E2EEMeeting()
    let key: CryptoKey | null = null
    vi.spyOn(E2EEMeeting.instance, 'getE2EEChatKey').mockImplementation(async () => key)
    const chatStore = useChatStore(createPinia())
    const sfuClient = makeSFUClient()
    const dispose = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    }).setupChatEvents(vi.fn())

    vi.stubGlobal('crypto', webcrypto)
    try {
      sfuClient.emitChatMessage({ messageId: 'm2', fromUser: 'bob', message: newMessage })
      await Promise.resolve()
      await Promise.resolve()
      expect(chatStore.chatMessages).toEqual([])
      sfuClient.emitSnapshot({
        messages: [
          { messageId: 'm1', fromUser: 'bob', message: oldMessage },
          {
            messageId: 'm2',
            fromUser: 'bob',
            message: newMessage,
            replyTo: { messageId: 'm1', fromName: 'Bob', message: oldMessage },
          },
        ],
        reactions: [],
      })
      key = currentKey
      document.dispatchEvent(new Event('meet:e2ee-context-ready'))
      await vi.waitFor(() =>
        expect(chatStore.chatMessages.map(({ message }) => message)).toEqual(['Readable reply']),
      )
      expect(chatStore.hasUnavailableEncryptedHistory).toBe(true)
      expect(chatStore.chatMessages[0]?.replyTo?.message).toBe(
        'Earlier encrypted message unavailable',
      )
    } finally {
      dispose()
      vi.unstubAllGlobals()
    }
  })

  it('discards pending history when the meeting is disposed', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const encrypted = await cipher(key, 'Previous meeting')
    const deferred = Promise.withResolvers<CryptoKey | null>()
    E2EEMeeting.instance = new E2EEMeeting()
    vi.spyOn(E2EEMeeting.instance, 'getE2EEChatKey').mockReturnValue(deferred.promise)
    const chatStore = useChatStore(createPinia())
    const sfuClient = makeSFUClient()
    const dispose = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    }).setupChatEvents(vi.fn())

    vi.stubGlobal('crypto', webcrypto)
    try {
      sfuClient.emitSnapshot({
        messages: [{ messageId: 'old', fromUser: 'bob', message: encrypted }],
        reactions: [],
      })
      dispose()
      chatStore.$reset()
      deferred.resolve(key)
      document.dispatchEvent(new Event('meet:e2ee-context-ready'))
      sfuClient.emitSnapshot({
        messages: [{ messageId: 'old', fromUser: 'bob', message: encrypted }],
        reactions: [],
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(chatStore.chatMessages).toEqual([])
      expect(chatStore.hasUnavailableEncryptedHistory).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('useChat E2EE gating', () => {
  it('uses a readable local original for a live quote after rotation', async () => {
    const oldKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const currentKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const oldMessage = await cipher(oldKey, 'Before rotation')
    const reply = await cipher(currentKey, 'After rotation')
    E2EEMeeting.instance = new E2EEMeeting()
    let key = oldKey
    vi.spyOn(E2EEMeeting.instance, 'getE2EEChatKey').mockImplementation(async () => key)
    const chatStore = useChatStore(createPinia())
    const sfuClient = makeSFUClient()
    const dispose = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    }).setupChatEvents(vi.fn())

    vi.stubGlobal('crypto', webcrypto)
    try {
      sfuClient.emitChatMessage({ messageId: 'old', fromUser: 'bob', message: oldMessage })
      await vi.waitFor(() => expect(chatStore.chatMessages[0]?.message).toBe('Before rotation'))

      key = currentKey
      sfuClient.emitChatMessage({
        messageId: 'new',
        fromUser: 'bob',
        message: reply,
        replyTo: { messageId: 'old', fromName: 'Bob', message: oldMessage },
      })

      await vi.waitFor(() =>
        expect(chatStore.chatMessages[1]).toMatchObject({
          message: 'After rotation',
          replyTo: { messageId: 'old', message: 'Before rotation' },
        }),
      )
    } finally {
      dispose()
      vi.unstubAllGlobals()
    }
  })

  it('does not send plaintext chat while E2EE is required but not ready', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient()
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })

    await chat.onSendChat('secret')

    expect(sfuClient.sendChatMessage).not.toHaveBeenCalled()
    expect(chatStore.addMessage).not.toHaveBeenCalled()
  })

  it('blocks inbound plaintext chat while E2EE is required', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient()
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })
    chat.setupChatEvents(vi.fn())

    sfuClient.emitChatMessage({
      fromUser: 'bob@example.com',
      fromName: 'Bob',
      message: 'plaintext',
    })
    await Promise.resolve()

    expect(chatStore.chatMessages.at(-1)?.message).toBe('[Unencrypted message blocked]')
  })

  it('applies the encrypted-room plaintext gate to quoted content', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient()
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })
    chat.setupChatEvents(vi.fn())

    sfuClient.emitChatMessage({
      fromUser: 'bob@example.com',
      fromName: 'Bob',
      message: 'Reply',
      replyTo: { messageId: 'original-1', fromName: 'Alice', message: 'Unencrypted quote' },
    })

    await vi.waitFor(() => {
      expect(chatStore.chatMessages.at(-1)?.replyTo).toEqual({
        messageId: 'original-1',
        fromName: 'Alice',
        message: '[Unencrypted message blocked]',
      })
    })
  })

  it('notifies for inbound messages while chat is closed', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    chatStore.isChatOpen = false
    const sfuClient = makeSFUClient({ isE2EERequired: vi.fn(() => false) })
    const notify = vi.fn()
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })
    chat.setupChatEvents(notify)

    sfuClient.emitChatMessage({
      fromUser: 'bob@example.com',
      fromName: 'Bob',
      message: 'Hello',
    })
    await Promise.resolve()

    expect(notify).toHaveBeenCalledWith({
      message: 'Hello',
      fromUser: 'bob@example.com',
      fromName: 'Bob',
      type: 'chat',
    })
  })

  it('shows an error without sending an oversized draft', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient({ isE2EERequired: () => false })
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })

    await expect(chat.onSendChat('🙂'.repeat(8192) + '!')).resolves.toBe(false)
    expect(toast.error).toHaveBeenCalledWith('This message is too long. Shorten it and try again.')
    expect(sfuClient.sendChatMessage).not.toHaveBeenCalled()
    expect(chatStore.chatMessages).toEqual([])
  })

  it('reports a rejected send as failed and leaves it out of the timeline', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient({
      isE2EERequired: () => false,
      sendChatMessage: vi.fn().mockRejectedValue(new Error('Connection lost')),
    })
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })

    await expect(chat.onSendChat('Please keep this draft')).resolves.toBe(false)
    expect(sfuClient.sendChatMessage).toHaveBeenCalled()
    expect(chatStore.chatMessages).toEqual([])
  })

  it('uses the server timestamp for locally sent messages', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const timestamp = '2026-07-28T12:02:00.000Z'
    const sfuClient = makeSFUClient({
      isE2EERequired: vi.fn(() => false),
      sendChatMessage: vi.fn(async () => ({
        success: true,
        timestamp,
        messageId: 'msg-1',
      })),
    })
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })

    await chat.onSendChat('After the poll')

    expect(chatStore.chatMessages.at(-1)?.timestamp).toBe(timestamp)
    expect(chatStore.chatMessages.at(-1)?.messageId).toBe('msg-1')
  })
})

describe('useChat pinning', () => {
  it('sends chat:pin with the message id via pinMessage', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient()
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })

    await chat.pinMessage('msg-42')

    expect(sfuClient.sendChatPin).toHaveBeenCalledWith('msg-42', 'pin', undefined)
  })

  it('updates the pinned message on chat:pin_updated', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient({ isE2EERequired: vi.fn(() => false) })
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })
    chat.setupChatEvents(vi.fn())

    sfuClient.emitPinUpdated({
      pinned: {
        messageId: 'msg-1',
        message: 'Pinned text',
        fromUser: 'bob@example.com',
        fromName: 'Bob',
        timestamp: '2026-07-28T12:00:00.000Z',
      },
    })
    await Promise.resolve()

    expect(chatStore.setPinnedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        user_id: 'bob@example.com',
        user_name: 'Bob',
        message: 'Pinned text',
      }),
    )
  })

  it('clears the pinned message when chat:pin_updated sends null', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient()
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })
    chat.setupChatEvents(vi.fn())

    sfuClient.emitPinUpdated({ pinned: null })
    await Promise.resolve()

    expect(chatStore.setPinnedMessage).toHaveBeenCalledWith(null)
  })

  it('restores an existing pinned message for late joiners', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient({ isE2EERequired: vi.fn(() => false) })
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })
    chat.setupChatEvents(vi.fn())

    sfuClient.emitExistingPinned({
      pinned: {
        messageId: 'msg-9',
        message: 'Welcome',
        fromUser: 'host@example.com',
        fromName: 'Host',
        timestamp: '2026-07-28T12:05:00.000Z',
      },
    })
    await Promise.resolve()

    expect(chatStore.setPinnedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-9', message: 'Welcome' }),
    )
    expect(chatStore.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-9', message: 'Welcome' }),
    )
  })

  it('carries the server message id onto inbound messages', async () => {
    E2EEMeeting.instance = new E2EEMeeting()
    const chatStore = makeChatStore()
    const sfuClient = makeSFUClient({ isE2EERequired: vi.fn(() => false) })
    const chat = useChat({
      chatStore,
      currentUser: fromPartial(currentUser),
      sfuClient: fromPartial(sfuClient),
    })
    chat.setupChatEvents(vi.fn())

    sfuClient.emitChatMessage({
      fromUser: 'bob@example.com',
      fromName: 'Bob',
      message: 'With an id',
      messageId: 'msg-5',
      timestamp: '2026-07-28T12:00:00.000Z',
    })
    await Promise.resolve()

    expect(chatStore.chatMessages.at(-1)?.messageId).toBe('msg-5')
  })
})
