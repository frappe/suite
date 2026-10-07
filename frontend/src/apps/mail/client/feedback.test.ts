import { beforeEach, expect, it, vi } from 'vitest'

import { raiseOptimisticToast, raisePromiseToast } from '@/apps/mail/utils'
import { reportMutationError } from '@/platform/feedback'

const toast = vi.hoisted(() => ({
  dismiss: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => 'pending'),
  error: vi.fn(),
}))
vi.mock('frappe-ui', () => ({ toast }))

beforeEach(() => vi.clearAllMocks())

it('confirms only successful writes and reports a handled refusal once', async () => {
  let finish: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  raiseOptimisticToast(pending, 'Archived')
  expect(toast.success).not.toHaveBeenCalled()
  finish?.()
  await pending
  expect(toast.success).toHaveBeenCalledWith('Archived', undefined)

  vi.clearAllMocks()
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
