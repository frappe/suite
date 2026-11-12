import { describe, expect, it } from 'vitest'

import { clearSelection, extendSelection, selectAllLoaded, toggleSelection } from './selection'

describe('file selection', () => {
  it('toggles explicit ids and selects a loaded shift range', () => {
    let state = toggleSelection(clearSelection(), 'b', ['a', 'b', 'c', 'd'])
    state = toggleSelection(state, 'd', ['a', 'b', 'c', 'd'], true)
    expect(state.selected).toEqual(['b', 'c', 'd'])
    expect(toggleSelection(state, 'c', ['a', 'b', 'c', 'd']).selected).toEqual(['b', 'd'])
  })

  it('grows and shrinks a Shift run from its anchor, keeping what was selected before it', () => {
    const visible = ['a', 'b', 'c', 'd', 'e']
    let state = toggleSelection(clearSelection(), 'a', visible)
    state = toggleSelection(state, 'c', visible)
    state = extendSelection(state, 'c', 'e', visible)
    expect(state.selected.sort()).toEqual(['a', 'c', 'd', 'e'])
    state = extendSelection(state, 'e', 'd', visible)
    expect(state.selected.sort()).toEqual(['a', 'c', 'd'])
    state = toggleSelection(state, 'b', visible, true)
    expect(state.selected.sort()).toEqual(['a', 'b', 'c'])
  })

  it('starts a Shift run where focus was when nothing anchors it', () => {
    const state = extendSelection(clearSelection(), 'b', 'c', ['a', 'b', 'c'])
    expect(state.selected).toEqual(['b', 'c'])
  })

  it('select all never includes unloaded rows', () => {
    expect(selectAllLoaded(['a', 'b']).selected).toEqual(['a', 'b'])
  })
})
