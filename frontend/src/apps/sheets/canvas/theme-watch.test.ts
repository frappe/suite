// The grid reads its colours from the theme's CSS tokens at paint time, so a
// theme switch only shows once something repaints. Switches come from places
// that never touch the grid (the command menu, the shortcut, settings), so
// the grid must repaint on its own.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGrid } from './index.js'
import { createMockCtx } from './painters/test-utils.js'

// MutationObserver callbacks run as a microtask.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the grid on a theme change', () => {
  const root = document.documentElement
  afterEach(() => {
    vi.restoreAllMocks()
    root.setAttribute('data-theme', 'light')
    root.removeAttribute('data-theme-mode')
  })

  function grid() {
    root.setAttribute('data-theme', 'light')
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(createMockCtx() as never)
    document.body.appendChild(canvas)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    const g = createGrid(canvas, {
      cells: { getStyle: () => ({}) },
      host: { canEdit: () => true },
    } as never)
    g.resize(800, 600)
    frames.splice(0).forEach((cb) => cb(0))
    return { g, frames }
  }

  it('asks for one frame per change, both ways', async () => {
    const { g, frames } = grid()
    root.setAttribute('data-theme', 'dark')
    await flush()
    expect(frames).toHaveLength(1)
    frames.splice(0).forEach((cb) => cb(0))

    root.setAttribute('data-theme', 'light')
    await flush()
    expect(frames).toHaveLength(1)
    g.destroy()
  })

  it('asks for no frame when the theme is written unchanged', async () => {
    // The theme module re-applies the theme on every save, often unchanged.
    const { g, frames } = grid()
    root.setAttribute('data-theme', 'light')
    root.setAttribute('data-theme-mode', 'light')
    await flush()
    expect(frames).toHaveLength(0)
    g.destroy()
  })

  it('stops listening once destroyed', async () => {
    const { g, frames } = grid()
    g.destroy()
    root.setAttribute('data-theme', 'dark')
    await flush()
    expect(frames).toHaveLength(0)
  })
})
