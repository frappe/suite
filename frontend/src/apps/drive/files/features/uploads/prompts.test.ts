import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from 'vue'

import { uploadPrompts } from './prompts'

const fake = vi.hoisted(() => ({
  toasts: [] as { message: string; action?: { label: string; onClick: () => void } }[],
  openSettings: vi.fn(),
}))
vi.mock('@/platform/feedback', () => ({
  confirm: async () => false,
  toast: {
    error: (message: string, options: { action?: { label: string; onClick: () => void } }) =>
      fake.toasts.push({ message, action: options.action }),
  },
}))
vi.mock('@/platform/settings', () => ({ openSettings: fake.openSettings }))

afterEach(() => {
  fake.toasts = []
})

const prompts = () => uploadPrompts({} as AppContext, async () => null)
const full = { total: 20 * 1024 * 1024, free: 1024, fitting: 0, count: 2 }

describe('a batch that does not fit', () => {
  it('offers to manage storage when nothing fits', async () => {
    expect(await prompts().quota(full)).toBe('cancel')
    const [shown] = fake.toasts
    expect(shown?.message).toBe('Not enough space to upload')
    expect(shown?.action?.label).toBe('Manage storage')
    shown?.action?.onClick()
    expect(fake.openSettings).toHaveBeenCalledWith('drive.statistics')
  })
})
