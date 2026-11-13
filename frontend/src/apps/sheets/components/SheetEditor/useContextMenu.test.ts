import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useContextMenu } from './useContextMenu.js'

// ISSUES #150. A right-click menu's buttons go when it closes, and focus with
// them, to <body>: typed keys, arrows and Ctrl+C/V did nothing until a click
// on the grid. The editor's `refocusGrid` takes it back unless something else
// (a dialog the item opened, a clicked input) has it.
describe('useContextMenu', () => {
  it('hands focus back to the grid when a menu closes', async () => {
    const refocusGrid = vi.fn()
    const { contextMenu, tabMenu } = useContextMenu({ getGrid: () => ({}), refocusGrid })
    contextMenu.open = true
    await nextTick()
    expect(refocusGrid).not.toHaveBeenCalled()
    contextMenu.open = false
    await nextTick()
    expect(refocusGrid).toHaveBeenCalledOnce()

    tabMenu.open = true
    await nextTick()
    tabMenu.open = false
    await nextTick()
    expect(refocusGrid).toHaveBeenCalledTimes(2)
  })

  it('does not when one menu replaces the other', async () => {
    const refocusGrid = vi.fn()
    const { contextMenu, openTabMenu } = useContextMenu({
      getGrid: () => ({}),
      getViewport: () => ({ width: 800, height: 600 }),
      refocusGrid,
    })
    contextMenu.open = true
    await nextTick()
    openTabMenu({ clientX: 10, clientY: 10 }, 'Sheet1')
    await nextTick()
    expect(refocusGrid).not.toHaveBeenCalled()
  })
})
