import { beforeEach, expect, it, vi } from 'vitest'

import { afterLanding, raiseOptimisticToast, raisePromiseToast } from '@/apps/mail/utils'
import { reportMutationError } from '@/platform/feedback'

const toast = vi.hoisted(() => ({
  dismiss: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => 'pending'),
  error: vi.fn(),
}))
vi.mock('frappe-ui', () => ({ toast }))

beforeEach(() => {
  vi.clearAllMocks()
  window.__ = (message: string) => message
})

// The rows change on the click, so the toast saying so does too; a refusal takes it down again.
it('says an optimistic write on the click, and takes it back when it is refused', async () => {
  toast.success.mockReturnValueOnce('archived')
  let refuse: ((error: Error) => void) | undefined
  const pending = new Promise<void>((_resolve, reject) => {
    refuse = reject
  })
  raiseOptimisticToast(pending, 'Archived', () => {})
  expect(toast.success).toHaveBeenCalledWith('Archived', {
    action: { label: 'Undo', onClick: expect.any(Function) },
  })

  refuse?.(new Error('Mail server is down'))
  await pending.catch(() => {})
  await vi.waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith('archived'))
  expect(toast.error.mock.calls).toEqual([['Mail server is down']])
})

it('waits for the answer when what it says is read off it', async () => {
  let finish: (() => void) | undefined
  const pending = new Promise<{ left_inbox: boolean }>((resolve) => {
    finish = () => resolve({ left_inbox: true })
  })
  raiseOptimisticToast(pending, (filed) => (filed.left_inbox ? 'Moved out of the Inbox' : 'Filed'))
  expect(toast.success).not.toHaveBeenCalled()
  finish?.()
  await pending
  await vi.waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith('Moved out of the Inbox', undefined),
  )
})

it('reports a handled refusal once', async () => {
  const refusal = new Error('Permission denied')
  reportMutationError(refusal)
  await raisePromiseToast(() => Promise.reject(refusal), 'Archiving', 'Archived')
  expect(toast.error.mock.calls).toEqual([['Permission denied']])
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.dismiss).toHaveBeenCalledWith('pending')

  vi.clearAllMocks()
  await raisePromiseToast(
    () => Promise.reject(new DOMException('Canceled', 'AbortError')),
    'Archiving',
    'Archived',
  )
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
})

// An Undo pressed while its write is in flight must not race it: the inverse sent alongside could
// land first and be overtaken, leaving the change in place under a toast that says it was undone.
it('holds an Undo until its write has landed', async () => {
  let land: (() => void) | undefined
  const forward = new Promise<void>((resolve) => {
    land = resolve
  })
  const inverse = vi.fn()
  afterLanding(forward, inverse)()
  await Promise.resolve()
  expect(inverse).not.toHaveBeenCalled()

  land?.()
  await vi.waitFor(() => expect(inverse).toHaveBeenCalledOnce())
})

it('drops an Undo whose write was refused, as there is nothing to take back', async () => {
  const forward = Promise.reject(new Error('Mail server is down'))
  forward.catch(() => {})
  const inverse = vi.fn()
  afterLanding(forward, inverse)()
  await forward.catch(() => {})
  await new Promise((resolve) => setTimeout(resolve))
  expect(inverse).not.toHaveBeenCalled()
})
