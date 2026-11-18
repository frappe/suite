import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { useListSelection } from './useListSelection'

// Two accounts sharing thread ids, as in the All accounts list: keys carry the account.
const KEYS = ['a:1', 'b:1', 'a:2', 'b:2', 'a:3']
const GROUPS = { today: ['a:1', 'b:1'], earlier: ['a:2', 'b:2', 'a:3'] } satisfies Record<
  string,
  string[]
>

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

  // Shift+arrow, one row at a time: each step names the row it left and the row it reached.
  it('ticks a run from where Shift+arrow began, and unticks one row a step on turning back', () => {
    const { selection, wrapper } = mountSelection()
    selection.moveCursor(['b:1'], ['a:2'], true)
    selection.moveCursor(['a:2'], ['b:2'], true)
    expect(selection.selections.value.sort()).toEqual(['a:2', 'b:1', 'b:2'])

    selection.moveCursor(['b:2'], ['a:2'], true)
    expect(selection.selections.value.sort()).toEqual(['a:2', 'b:1'])

    // Past the anchor, the run turns round it.
    selection.moveCursor(['a:2'], ['b:1'], true)
    selection.moveCursor(['b:1'], ['a:1'], true)
    expect(selection.selections.value.sort()).toEqual(['a:1', 'b:1'])
    wrapper.unmount()
  })

  it('keeps what was ticked before the run began', () => {
    const { selection, wrapper } = mountSelection()
    selection.toggleSelect(['a:3'], true)
    selection.moveCursor(['a:1'], ['b:1'], true)
    selection.moveCursor(['b:1'], ['a:1'], true)
    expect(selection.selections.value.sort()).toEqual(['a:1', 'a:3'])
    wrapper.unmount()
  })

  it('starts a new run where the cursor is after it moved without Shift', () => {
    const { selection, wrapper } = mountSelection()
    selection.moveCursor(['a:1'], ['b:1'], true)
    // The cursor walked on to b:2 without Shift, then Shift+arrow went up.
    selection.moveCursor(['b:2'], ['a:2'], true)
    expect(selection.selections.value.sort()).toEqual(['a:1', 'a:2', 'b:1', 'b:2'])
    wrapper.unmount()
  })

  it('starts a new run after walking away and back to where the last one stopped', () => {
    const { selection, wrapper } = mountSelection()
    selection.moveCursor(['a:1'], ['b:1'], true)
    selection.moveCursor(['b:1'], ['a:2'], true)
    // Down and back up without Shift, onto a:2 again.
    selection.moveCursor(['a:2'], ['b:2'], false)
    selection.moveCursor(['b:2'], ['a:2'], false)
    // Shift+arrow up from a:2 starts a run there, which keeps a:2 ticked, rather than shrinking
    // the old run back toward a:1.
    selection.moveCursor(['a:2'], ['b:1'], true)
    expect(selection.selections.value.sort()).toEqual(['a:1', 'a:2', 'b:1'])
    wrapper.unmount()
  })

  it('takes every thread a stack or a day stands for', () => {
    const { selection, wrapper } = mountSelection()
    selection.moveCursor(['b:1'], GROUPS.earlier, true)
    expect(selection.selections.value.sort()).toEqual(['a:2', 'a:3', 'b:1', 'b:2'])
    wrapper.unmount()
  })
})
