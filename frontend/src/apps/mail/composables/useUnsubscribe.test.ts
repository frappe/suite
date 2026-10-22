import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import type { Mail } from '@/apps/mail/types'

// The look-up's answer, and the request held for Undo as commitAfterUndo would hold it.
const answer = reactive<{ data: Record<string, unknown> | undefined }>({ data: undefined })
const asked: unknown[] = []
vi.mock('@/api', () => ({
  api: { mail: { messages: { unsubscribeOptions: 'unsubscribeOptions' } } },
  useQuery: vi.fn((_reference: string, input: () => unknown) => {
    asked.push(input())
    return answer
  }),
}))
const held: { removal: unknown; restore: () => void; onFailed: (error: unknown) => void }[] = []
vi.mock('@/apps/mail/utils', () => ({
  commitAfterUndo: vi.fn((options: (typeof held)[number]) => held.push(options)),
}))
const toastError = vi.fn()
vi.mock('frappe-ui', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))
vi.stubGlobal('__', (text: string) => text)

const mail = (id: string, fields: Partial<Mail> = {}) =>
  ({ id, from_email: 'news@example.com', ...fields }) as Mail
const ONE_CLICK = {
  one_click: 'https://n.example/u',
  mailto: null,
  link: 'https://n.example/u',
  unsubscribed: false,
}
const PAGE_ONLY = {
  one_click: null,
  mailto: null,
  link: 'https://n.example/p',
  unsubscribed: false,
}

const setUp = async (allowed: (mail: Mail) => boolean = () => true) => {
  const { useUnsubscribe } = await import('./useUnsubscribe')
  return useUnsubscribe(
    () => 'acc',
    () => [mail('a'), mail('b'), mail('c')],
    allowed,
  )
}

describe('useUnsubscribe', () => {
  beforeEach(() => {
    answer.data = undefined
    asked.length = 0
    held.length = 0
    toastError.mockClear()
  })

  it('asks only about the mail it may offer it on, and offers it where the header does', async () => {
    answer.data = { a: ONE_CLICK }
    const { offers } = await setUp((m) => m.id !== 'c')
    expect(asked).toEqual([{ account: 'acc', ids: ['a', 'b'] }])
    expect([offers(mail('a')), offers(mail('b')), offers(mail('c'))]).toEqual([true, false, false])
  })

  it('reads as unsubscribed at once, holds the request for Undo, and Undo takes it back', async () => {
    answer.data = { a: ONE_CLICK }
    const { isUnsubscribed, unsubscribe } = await setUp()
    unsubscribe(mail('a'))
    expect(isUnsubscribed(mail('a'))).toBe(true)
    expect(held.map((h) => h.removal)).toEqual([{ kind: 'unsubscribe', account: 'acc', id: 'a' }])

    held[0].restore()
    expect(isUnsubscribed(mail('a'))).toBe(false)
  })

  it('opens the page of a sender offering nothing else, and marks nothing', async () => {
    answer.data = { a: PAGE_ONLY }
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { isUnsubscribed, unsubscribe } = await setUp()
    unsubscribe(mail('a'))
    expect(open).toHaveBeenCalledWith('https://n.example/p', '_blank', 'noopener')
    expect(held).toEqual([])
    expect(isUnsubscribed(mail('a'))).toBe(false)
  })

  it('offers the sender’s page when the request is refused', async () => {
    answer.data = { a: ONE_CLICK }
    const { unsubscribe } = await setUp()
    unsubscribe(mail('a'))
    held[0].onFailed(new Error('refused'))
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't unsubscribe.",
      expect.objectContaining({ action: expect.objectContaining({ label: 'Open their page' }) }),
    )
  })

  it('says unsubscribed of mail the server has marked so', async () => {
    answer.data = { a: { ...ONE_CLICK, unsubscribed: true } }
    const { isUnsubscribed, unsubscribe } = await setUp()
    expect(isUnsubscribed(mail('a'))).toBe(true)
    unsubscribe(mail('a'))
    expect(held).toEqual([])
  })

  it('says unsubscribed only in the account it was done in', async () => {
    answer.data = { a: ONE_CLICK }
    const { useUnsubscribe } = await import('./useUnsubscribe')
    let account = 'acc'
    const { isUnsubscribed, unsubscribe } = useUnsubscribe(
      () => account,
      () => [mail('a')],
      () => true,
    )
    unsubscribe(mail('a'))
    account = 'other'
    expect(isUnsubscribed(mail('a'))).toBe(false)
  })
})
