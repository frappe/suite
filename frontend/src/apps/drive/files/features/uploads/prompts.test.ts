import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from 'vue'

import { setTweaks } from '@/platform/tweaks'

import { uploadPrompts } from './prompts'

const fake = vi.hoisted(() => ({
  toasts: [] as { message: string; action?: { label: string; onClick: () => void } }[],
  confirms: 0,
  openSettings: vi.fn(),
}))
vi.mock('@/platform/feedback', () => ({
  confirm: async () => {
    fake.confirms += 1
    return false
  },
  toast: {
    error: (message: string, options: { action?: { label: string; onClick: () => void } }) =>
      fake.toasts.push({ message, action: options.action }),
  },
}))
vi.mock('@/platform/settings', () => ({ openSettings: fake.openSettings }))

afterEach(() => {
  fake.toasts = []
  fake.confirms = 0
  setTweaks(['t30-messages'], true)
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

  it('asks in a dialog with the tweak off', async () => {
    setTweaks(['t30-messages'], false)
    expect(await prompts().quota(full)).toBe('cancel')
    expect(fake.toasts).toEqual([])
    expect(fake.confirms).toBe(1)
  })
})
