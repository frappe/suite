import { describe, expect, it } from 'vitest'
import { clearSelection, selectAllLoaded, toggleSelection } from './selection'

describe('file selection', () => {
  it('toggles explicit ids and selects a loaded shift range', () => {
    let state = toggleSelection(clearSelection(), 'b', ['a', 'b', 'c', 'd'])
    state = toggleSelection(state, 'd', ['a', 'b', 'c', 'd'], true)
    expect(state.selected).toEqual(['b', 'c', 'd'])
    expect(toggleSelection(state, 'c', ['a', 'b', 'c', 'd']).selected).toEqual(['b', 'd'])
  })

  it('select all never includes unloaded rows', () => {
    expect(selectAllLoaded(['a', 'b']).selected).toEqual(['a', 'b'])
  })
})

