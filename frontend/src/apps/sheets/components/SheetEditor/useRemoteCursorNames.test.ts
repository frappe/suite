import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useRemoteCursorNames } from './useRemoteCursorNames'

type Cursor = { moveKey: string; labelPeers: string[] }
type Shown = { user: string; label: string | null; labelPeers: string[]; x: number; y: number }

function setup(start: Record<string, Cursor>, shownAt = { x: 100, y: 50 }) {
  const cursors = shallowRef(new Map(Object.entries(start)))
  const shown = shallowRef<Shown[]>(
    [...cursors.value].map(([user, cursor]) => ({
      user,
      label: cursor.labelPeers.length ? user : null,
      labelPeers: cursor.labelPeers,
      ...shownAt,
    })),
  )
  const scope = effectScope()
  const names = scope.run(() => useRemoteCursorNames(cursors, shown))!
  const set = async (next: Record<string, Cursor>) => {
    cursors.value = new Map(Object.entries(next))
    await nextTick()
  }
  return { names, set, scope, shown }
}

const solo = (moveKey: string): Cursor => ({ moveKey, labelPeers: ['7'] })
const wait = async (ms: number) => {
  vi.advanceTimersByTime(ms)
  await nextTick()
}

describe('a remote cursor name', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows when the peer arrives and folds after three seconds', async () => {
    const { names, shown } = setup({ '7': solo('A1') })
    await nextTick()
    expect(names.isFolded(shown.value[0]!)).toBe(false)
    await wait(2999)
    expect(names.isFolded(shown.value[0]!)).toBe(false)
    await wait(1)
    expect(names.isFolded(shown.value[0]!)).toBe(true)
  })

  it('stays folded when the peer has not moved', async () => {
    const { names, set, shown } = setup({ '7': solo('A1') })
    await wait(3000)
    await set({ '7': solo('A1') })
    expect(names.isFolded(shown.value[0]!)).toBe(true)
  })

  it('comes back when the peer moves and gets a fresh three seconds', async () => {
    const { names, set, shown } = setup({ '7': solo('A1') })
    await wait(3000)
    await set({ '7': solo('B2') })
    expect(names.isFolded(shown.value[0]!)).toBe(false)
    await wait(2000)
    await set({ '7': solo('C3') })
    await wait(2000)
    expect(names.isFolded(shown.value[0]!)).toBe(false)
    await wait(1000)
    expect(names.isFolded(shown.value[0]!)).toBe(true)
  })

  it('names both people again when the second one moves onto a shared cell', async () => {
    const shared = (ravi: string) => ({
      '7': { moveKey: 'A1', labelPeers: ['7', '8'] },
      '8': { moveKey: ravi, labelPeers: [] },
    })
    const { names, set, shown } = setup(shared('A1'))
    await wait(3000)
    expect(names.isFolded(shown.value[0]!)).toBe(true)
    await set(shared('A1-edge'))
    expect(names.isFolded(shown.value[0]!)).toBe(false)
  })

  it('does not fold a cursor that has no label to fold', async () => {
    const { names, shown } = setup({ '8': { moveKey: 'A1', labelPeers: [] } })
    await wait(3000)
    expect(names.isFolded(shown.value[0]!)).toBe(false)
  })

  it('treats a peer who left and came back as newly arrived', async () => {
    const { names, set, shown } = setup({ '7': solo('A1') })
    await wait(3000)
    await set({})
    await set({ '7': solo('A1') })
    expect(names.isFolded(shown.value[0]!)).toBe(false)
  })

  it('cancels its timers when the editor closes', async () => {
    const { scope } = setup({ '7': solo('A1') })
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  describe('hovering the dot', () => {
    function over(names: ReturnType<typeof setup>['names'], clientX: number, clientY: number) {
      const wrapper = document.createElement('div')
      wrapper.getBoundingClientRect = () => new DOMRect(10, 20, 800, 600)
      wrapper.addEventListener('mousemove', names.trackPointer)
      wrapper.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))
    }

    it('unfolds the name while the pointer is on the dot, in the wrapper’s own space', async () => {
      const { names, shown } = setup({ '7': solo('A1') })
      await wait(3000)
      // The dot sits on the cell's corner, (100, 50) inside a wrapper at (10, 20).
      over(names, 110, 70)
      expect(names.isFolded(shown.value[0]!)).toBe(false)
      over(names, 130, 70)
      expect(names.isFolded(shown.value[0]!)).toBe(true)
    })

    it('folds again when the pointer leaves the grid', async () => {
      const { names, shown } = setup({ '7': solo('A1') })
      await wait(3000)
      over(names, 110, 70)
      names.clearPointer()
      expect(names.isFolded(shown.value[0]!)).toBe(true)
    })

    it('follows a dot the grid has scrolled away from the pointer', async () => {
      const { names, shown } = setup({ '7': solo('A1') })
      await wait(3000)
      over(names, 110, 70)
      shown.value = [{ ...shown.value[0]!, y: 400 }]
      expect(names.isFolded(shown.value[0]!)).toBe(true)
    })
  })
})
