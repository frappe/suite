import { beforeEach, describe, expect, it, vi } from 'vitest'

// The server, held until a test lets it answer.
const pending: { resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = []
const calls: string[] = []
vi.mock('@/api', () => ({
  api: {
    mail: {
      screener: { reject: 'reject', undo: 'undo', allow: 'allow' },
      screening: { block: 'block' },
      messages: { setFolders: 'setFolders' },
    },
  },
  client: {
    mutation: vi.fn((reference: string) => {
      calls.push(reference)
      return new Promise((resolve, reject) => pending.push({ resolve, reject }))
    }),
  },
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'acc',
    mailboxes: { refetch: () => Promise.resolve() },
    userResource: { data: { accounts: [{ name: 'acc', on_block_old_mail: 'Ask' }] } },
  }),
}))
const shown: { message: string; action?: { onClick: () => void } }[] = []
vi.mock('@/apps/mail/utils', () => ({
  raiseToast: vi.fn((message: string, _type: string, action?: { onClick: () => void }) => {
    shown.push({ message, action })
    return shown.length
  }),
}))
const undoSlot: { action?: () => void } = {}
vi.mock('@/apps/mail/utils/composables', () => ({
  useUndo: () => ({
    setUndoAction: (action?: () => void) => (undoSlot.action = action),
    prependUndoAction: vi.fn(),
    undo: () => undoSlot.action?.(),
  }),
}))
const dismissed: unknown[] = []
vi.mock('frappe-ui', () => ({ toast: { dismiss: (id: unknown) => dismissed.push(id) } }))
vi.stubGlobal('__', (text: string) => text)

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const load = async () => (await import('./useScreener')).useScreener()

describe('blocking a sender', () => {
  beforeEach(() => {
    pending.length = 0
    calls.length = 0
    shown.length = 0
    dismissed.length = 0
  })

  it('says so on the click, before the server answers', async () => {
    const screener = await load()
    void screener.deny(['spam@example.com'])
    expect(shown.map((toast) => toast.message)).toEqual([
      'Sender blocked. Future mail will go to Junk.',
    ])
    expect(calls).toEqual(['reject'])
  })

  it('takes it back with Undo only once it has landed', async () => {
    const screener = await load()
    const done = screener.deny(['spam@example.com'])
    shown[0].action!.onClick()
    await settle()
    expect(calls).toEqual(['reject'])

    pending[0].resolve({ 'spam@example.com': ['m1'] })
    await settle()
    pending[1].resolve({ inbox: 0 })
    expect(await done).toBe(true)
    await settle()
    expect(calls).toEqual(['reject', 'block', 'undo'])
  })

  it('takes the toast down when the block fails', async () => {
    const screener = await load()
    const done = screener.deny(['spam@example.com'])
    pending[0].reject(new Error('refused'))
    expect(await done).toBe(false)
    await settle()
    expect(dismissed).toEqual([1])
  })

  it('asks nothing about the old mail of a block undone before it landed', async () => {
    const screener = await load()
    const done = screener.deny(['spam@example.com'])
    shown[0].action!.onClick()
    pending[0].resolve({})
    await settle()
    pending[1].resolve({ inbox: 3 })
    await done
    await settle()
    expect(screener.oldMailPrompt.value).toBeNull()
  })

  it('asks about the old mail once the block says there is some', async () => {
    const screener = await load()
    const done = screener.deny(['spam@example.com'])
    expect(screener.oldMailPrompt.value).toBeNull()
    pending[0].resolve({})
    await settle()
    pending[1].resolve({ inbox: 3 })
    await done
    await settle()
    expect(screener.oldMailPrompt.value).toMatchObject({ emails: ['spam@example.com'], count: 3 })
  })
})

describe('trusting a sender', () => {
  beforeEach(() => {
    pending.length = 0
    calls.length = 0
    shown.length = 0
    dismissed.length = 0
  })

  it('says so on the click, and Undo waits for it to land', async () => {
    const screener = await load()
    const done = screener.allow(['news@example.com'])
    expect(shown.map((toast) => toast.message)).toEqual(['Sender marked as trusted.'])
    shown[0].action!.onClick()
    await settle()
    expect(calls).toEqual(['allow'])
    pending[0].resolve({ 'news@example.com': ['m1'] })
    await done
    await settle()
    expect(calls).toEqual(['allow', 'undo'])
  })

  it('takes the toast down when it is refused', async () => {
    const screener = await load()
    const done = screener.allow(['news@example.com'])
    pending[0].reject(new Error('refused'))
    await done
    expect(dismissed).toEqual([1])
  })
})
