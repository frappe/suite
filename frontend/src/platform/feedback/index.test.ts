import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  danger: vi.fn(),
  prompt: vi.fn(),
  error: vi.fn(),
}))

vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  return {
    FrappeUIProvider: defineComponent({ template: '<slot />' }),
    dialog: { confirm: mocks.confirm, danger: mocks.danger, prompt: mocks.prompt },
    toast: { error: mocks.error },
  }
})

import { confirm, hostChallenge, prompt, reportMutationError } from './index'

beforeEach(() => vi.clearAllMocks())

describe('feedback', () => {
  it('turns confirm callbacks into a boolean result', async () => {
    mocks.confirm.mockImplementationOnce((options) => options.onConfirm())
    await expect(confirm({ title: 'Continue?' })).resolves.toBe(true)
    mocks.danger.mockImplementationOnce((options) => options.onCancel())
    await expect(confirm({ title: 'Delete?', destructive: true })).resolves.toBe(false)
  })

  it('returns prompt values and reports mutation errors as toasts', async () => {
    mocks.prompt.mockImplementationOnce((options) => options.onConfirm({ values: { password: 'secret' } }))
    await expect(prompt({ title: 'Unlock', fields: [{ name: 'password', type: 'text' }] })).resolves.toEqual({ password: 'secret' })
    reportMutationError({ type: 'DriveLocked', message: 'Locked', status: 403 })
    expect(mocks.error).toHaveBeenCalledWith('Locked')
  })

  it('hosts a challenge, resolves its prompt, and retries the failed action', async () => {
    mocks.prompt.mockImplementationOnce((options) => options.onConfirm({ values: { password: 'open' } }))
    let registered: ((error: any, retry: () => Promise<unknown>) => Promise<unknown>) | undefined
    const cleanup = vi.fn()
    const state = {
      onChallenge: vi.fn((_type, handler) => {
        registered = handler
        return cleanup
      }),
    }
    const resolve = vi.fn()
    const remove = hostChallenge(state, 'DriveLocked', {
      title: 'Unlock link',
      message: (error) => `Unlock ${error.link}`,
      fields: [{ name: 'password', type: 'text' }],
      resolve,
    })
    const retry = vi.fn(async () => 'retried')
    await expect(registered?.(
      { type: 'DriveLocked', message: 'Locked', status: 403, link: 'link-1' },
      retry,
    )).resolves.toBe('retried')
    expect(resolve).toHaveBeenCalledWith({ password: 'open' }, expect.objectContaining({ link: 'link-1' }))
    expect(retry).toHaveBeenCalledOnce()
    remove()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('does not retry a challenge when the prompt is cancelled', async () => {
    mocks.prompt.mockImplementationOnce((options) => options.onCancel())
    let registered: ((error: any, retry: () => Promise<unknown>) => Promise<unknown>) | undefined
    const state = {
      onChallenge: vi.fn((_type, handler) => {
        registered = handler
        return () => {}
      }),
    }
    const resolve = vi.fn()
    hostChallenge(state, 'DriveLocked', {
      title: 'Unlock link', fields: [{ name: 'password', type: 'text' }], resolve,
    })
    const retry = vi.fn()
    await registered?.({ type: 'DriveLocked', message: 'Locked', status: 403 }, retry)
    expect(resolve).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
  })
})
