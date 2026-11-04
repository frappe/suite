import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive } from 'vue'

import { useMessageReactions } from '@/apps/mail/composables/useMessageReactions'
import type { Mail } from '@/apps/mail/types'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  undo: vi.fn(),
  raiseToast: vi.fn(() => 'toast-id'),
  setUndoAction: vi.fn(),
  retireUndoAction: vi.fn(),
}))

vi.mock('frappe-ui', () => ({ toast: { dismiss: vi.fn() } }))
vi.mock('@/api', () => ({
  api: { mail: { messages: { react: 'react' }, scheduled: { undoReaction: 'undo' } } },
  useMutation: (reference: string) => ({ run: reference === 'react' ? mocks.send : mocks.undo }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: mocks.raiseToast }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useOwnEmails: () => computed(() => new Set(['me@frappe.io'])),
  useUndo: () => ({ setUndoAction: mocks.setUndoAction, retireUndoAction: mocks.retireUndoAction }),
}))

const flush = () => new Promise((resolve) => setTimeout(resolve))

const mail = (reactions: Mail['reactions'] = []) => reactive({ id: 'm1', reactions }) as Mail

const setup = () => {
  const reload = vi.fn()
  return { reload, ...useMessageReactions(() => 'acct', reload) }
}

const emojis = (reactions: { emoji: string }[]) => reactions.map((reaction) => reaction.emoji)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('__', (text: string) => text)
  mocks.send.mockResolvedValue({ submission_id: 's1', undo_send_period: 5 })
  mocks.undo.mockResolvedValue(null)
})

describe('useMessageReactions', () => {
  it('shows a reaction at once, sends it, and reloads the thread', async () => {
    const { react, reactionsOn, reload } = setup()
    const message = mail()
    void react(message, '🎉')
    expect(emojis(reactionsOn(message))).toEqual(['🎉'])
    await flush()
    expect(mocks.send).toHaveBeenCalledWith({ account: 'acct', id: 'm1', emoji: '🎉' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('sends nothing for an emoji the reader already reacted with', async () => {
    const { react } = setup()
    await react(mail([{ emoji: '😂', from_name: 'Me', from_email: 'ME@frappe.io' }]), '😂')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.raiseToast).toHaveBeenCalled()
  })

  it('lets the reader join an emoji someone else started', async () => {
    const { react } = setup()
    await react(mail([{ emoji: '😂', from_name: 'Ana', from_email: 'ana@x.io' }]), '😂')
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ emoji: '😂' }))
  })

  it('takes the reaction back off the message when sending fails', async () => {
    mocks.send.mockRejectedValue(new Error('refused'))
    const { react, reactionsOn } = setup()
    const message = mail()
    await react(message, '🎉')
    expect(reactionsOn(message)).toEqual([])
    expect(mocks.raiseToast).toHaveBeenCalledWith(expect.any(String), 'error')
  })

  it('does not count a reaction twice once the thread comes back with it', async () => {
    const { react, reactionsOn } = setup()
    const message = mail()
    await react(message, '🎉')
    message.reactions = [{ emoji: '🎉', from_name: 'Me', from_email: 'me@frappe.io' }]
    expect(emojis(reactionsOn(message))).toEqual(['🎉'])
  })

  it('offers Undo for what the server holds, which cancels it by its submission', async () => {
    const { react, reactionsOn, reload } = setup()
    const message = mail()
    await react(message, '🎉')
    const undoNow = mocks.setUndoAction.mock.calls[0][0] as () => void
    undoNow()
    expect(reactionsOn(message)).toEqual([])
    await flush()
    expect(mocks.undo).toHaveBeenCalledWith({ account: 'acct', id: 's1' })
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('keeps a reaction on the message it was made on', async () => {
    const { react, reactionsOn } = setup()
    const other = reactive({ id: 'm2', reactions: [] }) as unknown as Mail
    await react(mail(), '🎉')
    expect(reactionsOn(other)).toEqual([])
  })
})
