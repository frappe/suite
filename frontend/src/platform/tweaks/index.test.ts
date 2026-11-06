import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick } from 'vue'

const KEY = 'suite.tweaks'

/** A fresh page load: the module reads browser storage again. */
async function load() {
  vi.resetModules()
  return import('./index')
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('tweaks', () => {
  it('starts with every tweak on', async () => {
    const { isTweakOn } = await load()
    expect(isTweakOn('t1')).toBe(true)
    expect(isTweakOn('t33-undo-remove')).toBe(true)
  })

  it('updates a component at once, and a switch survives a reload', async () => {
    const { setTweaks, useTweak } = await load()
    const opensAtOnce = useTweak('t8')
    const label = computed(() => (opensAtOnce.value ? 'new' : 'old'))
    expect(label.value).toBe('new')

    setTweaks(['t8', 't7'], false)
    await nextTick()
    expect(label.value).toBe('old')

    const reloaded = await load()
    expect(reloaded.isTweakOn('t8')).toBe(false)
    expect(reloaded.isTweakOn('t7')).toBe(false)
    expect(reloaded.isTweakOn('t6')).toBe(true)

    reloaded.setTweaks(['t8'], true)
    expect((await load()).isTweakOn('t8')).toBe(true)
  })

  it('keeps working when browser storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { isTweakOn, setTweaks } = await load()
    expect(isTweakOn('t5')).toBe(true)
    expect(() => setTweaks(['t5'], false)).not.toThrow()
    expect(isTweakOn('t5')).toBe(false)
  })

  it('ignores unknown ids and stored values it cannot read', async () => {
    localStorage.setItem(KEY, JSON.stringify(['t7', 'no-such-tweak', 42, null]))
    const { isTweakOn } = await load()
    expect(isTweakOn('t7')).toBe(false)
    expect(isTweakOn('t10')).toBe(true)

    for (const raw of ['not json', '{"t7": false}', '"t7"']) {
      localStorage.setItem(KEY, raw)
      expect((await load()).isTweakOn('t7')).toBe(true)
    }
  })

  it('follows a switch flipped in another tab', async () => {
    const { isTweakOn } = await load()
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '["t12"]' }))
    expect(isTweakOn('t12')).toBe(false)
  })
})
