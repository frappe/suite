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

import { confirm, prompt, reportMutationError } from './index'

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
})
