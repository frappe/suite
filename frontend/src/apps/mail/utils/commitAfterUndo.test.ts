import { beforeEach, describe, expect, it, vi } from 'vitest'

const shown: { action: { onClick: () => void }; onAutoClose: () => void; onDismiss: () => void }[] =
  []
vi.mock('frappe-ui', async (original) => ({
  ...(await original<typeof import('frappe-ui')>()),
  toast: {
    dismiss: vi.fn(),
    success: vi.fn((_message: string, options: (typeof shown)[number]) => shown.push(options)),
    error: vi.fn(),
  },
}))

// The server, and what has been written down for a page that closes mid-wait.
const sent: unknown[] = []
let refuse = false
const stored = new Map<string, unknown>()
vi.mock('@/apps/mail/utils/pendingRemovals', () => ({
  sendRemoval: vi.fn((removal: unknown) => {
    sent.push(removal)
    return refuse ? Promise.reject(new Error('refused')) : Promise.resolve()
  }),
  rememberRemoval: vi.fn((removal: unknown) => {
    const key = String(stored.size + 1)
    stored.set(key, removal)
    return key
  }),
  forgetRemoval: vi.fn((key: string) => stored.delete(key)),
}))
vi.stubGlobal('__', (text: string) => text)

const load = async () => (await import('./index')).commitAfterUndo
const removal = { kind: 'draft', account: 'a', id: 'd1' } as const

describe('commitAfterUndo', () => {
  beforeEach(() => {
    shown.length = 0
    sent.length = 0
    stored.clear()
    refuse = false
  })

  it('writes the removal down while it waits, so a closed page leaves it to send later', async () => {
    const commitAfterUndo = await load()
    commitAfterUndo({ message: 'Draft discarded.', removal, restore: vi.fn() })
    expect([...stored.values()]).toEqual([removal])
    expect(sent).toEqual([])
  })

  it('puts the rows back on Undo, sends nothing and forgets it', async () => {
    const commitAfterUndo = await load()
    const restore = vi.fn()
    commitAfterUndo({ message: 'Draft discarded.', removal, restore })
    shown[0].action.onClick()
    shown[0].onDismiss()
    expect(restore).toHaveBeenCalledOnce()
    expect(sent).toEqual([])
    expect(stored.size).toBe(0)
  })

  it('sends the removal once the toast is gone, only once, then forgets it', async () => {
    const commitAfterUndo = await load()
    const onSent = vi.fn()
    commitAfterUndo({ message: 'Draft discarded.', removal, restore: vi.fn(), onSent })
    shown[0].onAutoClose()
    shown[0].onDismiss()
    expect(sent).toEqual([removal])
    await vi.waitFor(() => expect(onSent).toHaveBeenCalledOnce())
    expect(stored.size).toBe(0)
  })

  it('puts the rows back when the removal fails', async () => {
    const commitAfterUndo = await load()
    refuse = true
    const restore = vi.fn()
    commitAfterUndo({ message: 'Draft discarded.', removal, restore })
    shown[0].onDismiss()
    await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(stored.size).toBe(0))
  })

  it('offers the same Undo to Cmd/Ctrl+Z until the removal is sent', async () => {
    const commitAfterUndo = await load()
    const restore = vi.fn()
    let slot: (() => void) | undefined
    const retire = (action: () => void) => {
      if (slot === action) slot = undefined
    }
    commitAfterUndo({
      message: 'Draft discarded.',
      removal,
      restore,
      undoSlot: { set: (action) => (slot = action), retire },
    })
    slot!()
    expect(restore).toHaveBeenCalledOnce()
    expect(sent).toEqual([])
    expect(slot).toBeUndefined()
  })

  it('takes the shortcut back once the removal is sent', async () => {
    const commitAfterUndo = await load()
    let slot: (() => void) | undefined
    commitAfterUndo({
      message: 'Draft discarded.',
      removal,
      restore: vi.fn(),
      undoSlot: {
        set: (action) => (slot = action),
        retire: (action) => {
          if (slot === action) slot = undefined
        },
      },
    })
    shown[0].onAutoClose()
    expect(slot).toBeUndefined()
  })

  it('hands a refusal to the caller, where it has more to say than the message', async () => {
    const commitAfterUndo = await load()
    refuse = true
    const onFailed = vi.fn()
    commitAfterUndo({ message: 'Unsubscribed.', removal, restore: vi.fn(), onFailed })
    shown[0].onDismiss()
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledOnce())
  })
})
