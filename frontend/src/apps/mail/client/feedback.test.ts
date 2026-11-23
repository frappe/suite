import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  afterLanding,
  raiseOptimisticToast,
  raisePerAccountToast,
  raisePromiseToast,
} from '@/apps/mail/utils'
import { reportMutationError } from '@/platform/feedback'
import { TransportError } from '@/platform/transport'

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
  raiseOptimisticToast(pending, { onClick: 'Archived' }, () => {})
  expect(toast.success).toHaveBeenCalledWith('Archived', {
    action: { label: 'Undo', onClick: expect.any(Function) },
  })

  refuse?.(
    new TransportError({
      type: 'ValidationError',
      message: 'Mail server is down',
      status: 417,
      fromServer: true,
    }),
  )
  await pending.catch(() => {})
  await vi.waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith('archived'))
  expect(toast.error.mock.calls).toEqual([['Mail server is down']])
})

it('waits for the answer when what it says is read off it', async () => {
  let finish: (() => void) | undefined
  const pending = new Promise<{ left_inbox: boolean }>((resolve) => {
    finish = () => resolve({ left_inbox: true })
  })
  raiseOptimisticToast(pending, {
    onAnswer: (filed) => (filed.left_inbox ? 'Moved out of the Inbox' : 'Filed'),
  })
  expect(toast.success).not.toHaveBeenCalled()
  finish?.()
  await pending
  await vi.waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith('Moved out of the Inbox', undefined),
  )
})

// A message known before the answer can still wait for it, where the screen only changes then.
it('waits for the answer when told to, though the message is known', async () => {
  let finish: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  raiseOptimisticToast(pending, { onAnswer: 'Reminder removed' })
  expect(toast.success).not.toHaveBeenCalled()
  finish?.()
  await pending
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Reminder removed', undefined))
})

describe('an action carried out in several accounts', () => {
  const refusal = () =>
    new TransportError({
      type: 'ValidationError',
      message: 'Mail server is down',
      status: 417,
      fromServer: true,
    })
  // Each account's request, answered when the test says.
  const accounts = (count: number) => {
    const answers: { land: () => void; refuse: () => void }[] = []
    const requests = Array.from(
      { length: count },
      () =>
        new Promise<unknown>((resolve, reject) =>
          answers.push({ land: () => resolve({}), refuse: () => reject(refusal()) }),
        ),
    )
    return { settled: Promise.allSettled(requests), answers }
  }

  it('says so on the click, with its Undo, before any account answers', () => {
    toast.success.mockReturnValueOnce('moved')
    const { settled } = accounts(2)
    raisePerAccountToast(settled, { onClick: 'Threads moved to Trash' }, () => {})
    expect(toast.success).toHaveBeenCalledWith('Threads moved to Trash', {
      action: { label: 'Undo', onClick: expect.any(Function) },
    })
  })

  it('takes the toast down and says why when every account refuses, with nothing to undo', async () => {
    toast.success.mockReturnValueOnce('moved')
    const { settled, answers } = accounts(2)
    raisePerAccountToast(settled, { onClick: 'Threads moved to Trash' }, () => {})
    answers.forEach((a) => a.refuse())
    await vi.waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith('moved'))
    expect(toast.error.mock.calls).toEqual([['Mail server is down']])
  })

  it('when one account refuses, says why and still offers to undo the others', async () => {
    toast.success.mockReturnValueOnce('moved')
    const undo = vi.fn()
    const { settled, answers } = accounts(2)
    raisePerAccountToast(settled, { onClick: 'Threads moved to Trash' }, undo)
    answers[0].land()
    answers[1].refuse()
    await vi.waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith('moved'))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Mail server is down', {
      action: { label: 'Undo', onClick: expect.any(Function) },
    })
    const options = toast.error.mock.calls[0][1]
    options.action.onClick()
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('waits for every account when what it says is read off their answers', async () => {
    const { settled, answers } = accounts(2)
    raisePerAccountToast(
      settled,
      { onAnswer: (results) => `Filed in ${results.length} accounts` },
      () => {},
    )
    answers[0].land()
    await Promise.resolve()
    expect(toast.success).not.toHaveBeenCalled()
    answers[1].land()
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Filed in 2 accounts', {
        action: { label: 'Undo', onClick: expect.any(Function) },
      }),
    )
  })
})

it('reports a handled refusal once', async () => {
  const refusal = new TransportError({
    type: 'PermissionError',
    message: 'Permission denied',
    status: 403,
    fromServer: true,
  })
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
