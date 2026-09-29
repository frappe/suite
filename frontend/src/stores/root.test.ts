import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { useRootStore } from './root'

describe('root palette registry', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('registers reactive command groups and removes them on cleanup', () => {
    const root = useRootStore()
    const label = ref('First label')
    const run = vi.fn()
    const unregister = root.registerPaletteGroups('test-owner', () => [
      {
        id: 'test-group',
        label: 'Test',
        commands: [{ id: 'test-command', label: label.value, run }],
      },
    ])

    expect(root.paletteGroups[0]?.commands[0]?.label).toBe('First label')
    label.value = 'Updated label'
    expect(root.paletteGroups[0]?.commands[0]?.label).toBe('Updated label')

    unregister()
    expect(root.paletteGroups).toEqual([])
  })

  it('does not let stale cleanup remove a replacement registration', () => {
    const root = useRootStore()
    const oldGroups = [{ id: 'old', label: 'Old', commands: [] }]
    const newGroups = [{ id: 'new', label: 'New', commands: [] }]
    const unregisterOld = root.registerPaletteGroups('owner', oldGroups)

    root.registerPaletteGroups('owner', newGroups)
    unregisterOld()

    expect(root.paletteGroups).toEqual(newGroups)
  })
})
