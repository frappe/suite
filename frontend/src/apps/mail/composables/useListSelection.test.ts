import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { useListSelection } from './useListSelection'

// Two accounts sharing thread ids, as in the All accounts list: keys carry the account.
const KEYS = ['a:1', 'b:1', 'a:2', 'b:2', 'a:3']
const GROUPS: Record<string, string[]> = { today: ['a:1', 'b:1'], earlier: ['a:2', 'b:2', 'a:3'] }

const mountSelection = () => {
  let selection!: ReturnType<typeof useListSelection>
  const app = createApp(
    defineComponent({
      setup() {
        selection = useListSelection({ keys: () => KEYS, groupKeys: (key) => GROUPS[key] })
        return () => h('div')
      },
    }),
  )
  app.mount(document.createElement('div'))
  return { selection, wrapper: app }
}

const pressShift = (down: boolean) =>
  window.dispatchEvent(
    new KeyboardEvent(down ? 'keydown' : 'keyup', { key: 'Shift', shiftKey: down }),
  )

describe('useListSelection', () => {
  it('keeps the same thread id in two accounts apart', () => {
    const { selection, wrapper } = mountSelection()
    selection.toggleSelect(['a:1'], true)
    expect(selection.selections.value).toEqual(['a:1'])
    expect(selection.isGroupSelected('today')).toBe(false)
    wrapper.unmount()
  })

  it('ticks a whole day from its header, and shows it ticked', () => {
    const { selection, wrapper } = mountSelection()
    selection.toggleSelect(GROUPS.today, true)
    expect(selection.isGroupSelected('today')).toBe(true)
    expect(selection.isStackSelected(['a:1', 'b:1'])).toBe(true)
    expect(selection.isAllSelected.value).toBe(false)
    wrapper.unmount()
  })

  it('selects all and clears all', () => {
    const { selection, wrapper } = mountSelection()
    selection.toggleSelectAll(true)
    expect(selection.isAllSelected.value).toBe(true)
    selection.resetSelections()
    expect(selection.selections.value).toEqual([])
    wrapper.unmount()
  })

  it('ticks the range from the last tick on a shift-click', () => {
    const { selection, wrapper } = mountSelection()
    selection.toggleSelect(['b:1'], true)
    pressShift(true)
    selection.toggleSelect(['b:2'], true)
    pressShift(false)
    expect(selection.selections.value.sort()).toEqual(['a:2', 'b:1', 'b:2'])
    wrapper.unmount()
  })

  it('ticks only the clicked thread once Shift is released', () => {
    const { selection, wrapper } = mountSelection()
    selection.toggleSelect(['a:1'], true)
    selection.toggleSelect(['a:3'], true)
    expect(selection.selections.value).toEqual(['a:1', 'a:3'])
    wrapper.unmount()
  })
})
