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
// The options each was sent with: keepalive for one sent as the page goes.
const leftWith: { keepalive?: boolean }[] = []
let refuse = false
const stored = new Map<string, unknown>()
vi.mock('@/apps/mail/utils/pendingRemovals', () => ({
  sendRemoval: vi.fn((removal: unknown, options?: { keepalive?: boolean }) => {
    sent.push(removal)
    leftWith.push(options ?? {})
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
    // An earlier test's page goes, with whatever it left waiting.
    window.dispatchEvent(new Event('pagehide'))
    shown.length = 0
    sent.length = 0
    leftWith.length = 0
    stored.clear()
    refuse = false
  })

  it('writes the removal down while it waits, so a closed page leaves it to send later', async () => {
    const commitAfterUndo = await load()
    commitAfterUndo({ message: 'Draft discarded', removal, restore: vi.fn() })
    expect([...stored.values()]).toEqual([removal])
    expect(sent).toEqual([])
  })

  it('sends the removal as the page goes, in a request that outlives it, and only once', async () => {
    const commitAfterUndo = await load()
    // Its own, told apart from any an earlier test left waiting.
    const discarded = { kind: 'draft', account: 'a', id: 'd-left' } as const
    const sends = () => sent.flatMap((item, i) => (item === discarded ? [leftWith[i]] : []))
    const restore = vi.fn()
    commitAfterUndo({ message: 'Draft discarded', removal: discarded, restore })

    window.dispatchEvent(new Event('pagehide'))

    expect(sends()).toEqual([{ keepalive: true }])
    // The toast going with the page sends nothing more, and its Undo no longer brings anything back.
    shown.at(-1)!.onDismiss()
    shown.at(-1)!.action.onClick()
    window.dispatchEvent(new Event('pagehide'))
    expect(sends()).toHaveLength(1)
    expect(restore).not.toHaveBeenCalled()
  })

  it('sends nothing as the page goes once Undo has taken it back', async () => {
    const commitAfterUndo = await load()
    commitAfterUndo({ message: 'Draft discarded', removal, restore: vi.fn() })
    shown[0].action.onClick()

    window.dispatchEvent(new Event('pagehide'))

    expect(sent).toEqual([])
  })

  it('puts the rows back on Undo, sends nothing and forgets it', async () => {
    const commitAfterUndo = await load()
    const restore = vi.fn()
    commitAfterUndo({ message: 'Draft discarded', removal, restore })
    shown[0].action.onClick()
    shown[0].onDismiss()
    expect(restore).toHaveBeenCalledOnce()
    expect(sent).toEqual([])
    expect(stored.size).toBe(0)
  })

  it('sends the removal once the toast is gone, only once, then forgets it', async () => {
    const commitAfterUndo = await load()
    const onSent = vi.fn()
    commitAfterUndo({ message: 'Draft discarded', removal, restore: vi.fn(), onSent })
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
    commitAfterUndo({ message: 'Draft discarded', removal, restore })
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
      message: 'Draft discarded',
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
      message: 'Draft discarded',
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
    commitAfterUndo({ message: 'Unsubscribed', removal, restore: vi.fn(), onFailed })
    shown[0].onDismiss()
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledOnce())
  })
})
