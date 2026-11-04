import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, reactive } from 'vue'

import { useMessageReactions } from '@/apps/mail/composables/useMessageReactions'
import type { Mail } from '@/apps/mail/types'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  raiseToast: vi.fn(() => 'toast-id'),
  setUndoAction: vi.fn(),
  retireUndoAction: vi.fn(),
}))

vi.mock('frappe-ui', () => ({ toast: { dismiss: vi.fn() } }))
vi.mock('@/api', () => ({
  api: { mail: { messages: { react: 'react' } } },
  useMutation: () => ({ run: mocks.send }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: mocks.raiseToast }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useOwnEmails: () => computed(() => new Set(['me@frappe.io'])),
  useUndo: () => ({ setUndoAction: mocks.setUndoAction, retireUndoAction: mocks.retireUndoAction }),
}))

const UNDO_SECONDS = 10

const mail = (reactions: Mail['reactions'] = []) => reactive({ id: 'm1', reactions }) as Mail

const setup = () => {
  const reload = vi.fn()
  const app = createApp({})
  app.provide('$user', { data: { undo_send_period: String(UNDO_SECONDS) } })
  return { reload, ...app.runWithContext(() => useMessageReactions(() => 'acct', reload)) }
}

const emojis = (reactions: { emoji: string }[]) => reactions.map((reaction) => reaction.emoji)

const windowCloses = () => vi.advanceTimersByTimeAsync(UNDO_SECONDS * 1000)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('__', (text: string) => text)
  mocks.send.mockResolvedValue({ id: 'r1', thread_id: 't1' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useMessageReactions', () => {
  it('shows a reaction at once, but sends nothing while it can still be undone', async () => {
    const { react, reactionsOn } = setup()
    const message = mail()
    react(message, '🎉')
    expect(emojis(reactionsOn(message))).toEqual(['🎉'])
    await vi.advanceTimersByTimeAsync(UNDO_SECONDS * 1000 - 1)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('sends when the undo window closes, then reloads the thread', async () => {
    const { react, reload } = setup()
    react(mail(), '🎉')
    await windowCloses()
    expect(mocks.send).toHaveBeenCalledWith({ account: 'acct', id: 'm1', emoji: '🎉' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('offers Undo for as long as the window lasts', () => {
    const { react } = setup()
    react(mail(), '🎉')
    expect(mocks.raiseToast).toHaveBeenCalledWith(
      expect.any(String),
      'success',
      expect.objectContaining({ label: 'Undo' }),
      UNDO_SECONDS * 1000,
    )
  })

  it('never sends what is undone, and takes it off the message', async () => {
    const { react, reactionsOn } = setup()
    const message = mail()
    react(message, '🎉')
    const undoNow = mocks.setUndoAction.mock.calls[0][0] as () => void
    undoNow()
    expect(reactionsOn(message)).toEqual([])
    await windowCloses()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('takes Undo away once the window has closed', async () => {
    const { react } = setup()
    react(mail(), '🎉')
    const undoNow = mocks.setUndoAction.mock.calls[0][0]
    await windowCloses()
    expect(mocks.retireUndoAction).toHaveBeenCalledWith(undoNow)
  })

  it('does nothing for an emoji the reader already reacted with', async () => {
    const { react } = setup()
    react(mail([{ emoji: '😂', from_name: 'Me', from_email: 'ME@frappe.io' }]), '😂')
    await windowCloses()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.setUndoAction).not.toHaveBeenCalled()
    expect(mocks.raiseToast).toHaveBeenCalled()
  })

  it('does not take the same emoji twice while the first is still waiting', async () => {
    const { react } = setup()
    const message = mail()
    react(message, '🎉')
    react(message, '🎉')
    await windowCloses()
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('lets the reader join an emoji someone else started', async () => {
    const { react } = setup()
    react(mail([{ emoji: '😂', from_name: 'Ana', from_email: 'ana@x.io' }]), '😂')
    await windowCloses()
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ emoji: '😂' }))
  })

  it('takes the reaction off the message and says why when sending fails', async () => {
    mocks.send.mockRejectedValue(new Error('You cannot react to mail from a mailing list.'))
    const { react, reactionsOn } = setup()
    const message = mail()
    react(message, '🎉')
    await windowCloses()
    expect(reactionsOn(message)).toEqual([])
    expect(mocks.raiseToast).toHaveBeenCalledWith(
      'You cannot react to mail from a mailing list.',
      'error',
    )
  })

  it('does not count a reaction twice once the thread comes back with it', async () => {
    const { react, reactionsOn } = setup()
    const message = mail()
    react(message, '🎉')
    await windowCloses()
    message.reactions = [{ emoji: '🎉', from_name: 'Me', from_email: 'me@frappe.io' }]
    expect(emojis(reactionsOn(message))).toEqual(['🎉'])
  })

  it('offers nothing on a message that cannot be reacted to, and says why', async () => {
    const { react, reactionsOn } = setup()
    const message = reactive({ id: 'm1', cannot_react: 'A list.' }) as unknown as Mail
    react(message, '🎉')
    await windowCloses()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(reactionsOn(message)).toEqual([])
    expect(mocks.raiseToast).toHaveBeenCalledWith('A list.', 'error')
  })

  it('keeps a reaction on the message it was made on', () => {
    const { react, reactionsOn } = setup()
    const other = reactive({ id: 'm2', reactions: [] }) as unknown as Mail
    react(mail(), '🎉')
    expect(reactionsOn(other)).toEqual([])
  })
})
