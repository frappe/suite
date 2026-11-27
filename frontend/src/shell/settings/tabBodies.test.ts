import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import type { SettingsTab } from '@/shell/settings/settings'
import { loadTabBody, preloadTabBodies } from '@/shell/settings/tabBodies'

const Body = defineComponent({ name: 'Body', render: () => null })

let ids = 0
function tab(body: SettingsTab['body']): SettingsTab {
  ids += 1
  return { id: `test.tab-${ids}`, label: () => 'Tab', icon: 'lucide-cog', body }
}

afterEach(() => vi.useRealTimers())

describe('settings tab bodies', () => {
  it('fetches a body loaded ahead only once, when its tab then opens', async () => {
    vi.useFakeTimers()
    const body = vi.fn(async () => Body)
    const shown = tab(body)

    preloadTabBodies(() => [shown])
    expect(body).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(body).toHaveBeenCalledTimes(1)

    await expect(loadTabBody(shown)).resolves.toBe(Body)
    expect(body).toHaveBeenCalledTimes(1)
  })

  it('tries a failed load again when the tab opens', async () => {
    const body = vi
      .fn<SettingsTab['body']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Body)
    const flaky = tab(body)

    await expect(loadTabBody(flaky)).rejects.toThrow('offline')
    await expect(loadTabBody(flaky)).resolves.toBe(Body)
  })
})
