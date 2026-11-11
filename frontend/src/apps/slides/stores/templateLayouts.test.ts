import { describe, expect, it, vi } from 'vitest'

import { firstLayout } from './templateLayouts'

// these tests draw nothing, and the drawing pulls in the editor's upload setup
vi.mock('@/apps/slides/collab/drawnDeck', () => ({ drawnSlides: () => [] }))
vi.mock('@/apps/slides/stores/presentation', async () => ({
  templateList: (await import('vue')).ref([]),
}))

describe('the layout a new presentation starts from', () => {
  const layouts = (count: number) => Array.from({ length: count }, (_, at) => ({ idx: at + 1 }))

  it("is a shipped theme's third, after its two covers", () => {
    expect(firstLayout({ title: 'Dark', layouts: layouts(4) })).toEqual({ idx: 3 })
    expect(firstLayout({ title: 'Light', layouts: layouts(3) })).toEqual({ idx: 3 })
  })

  it('is the first of a shipped theme too short to have its usual one', () => {
    expect(firstLayout({ title: 'Dark', layouts: layouts(2) })).toEqual({ idx: 1 })
  })

  it("is any other template's first", () => {
    expect(firstLayout({ title: 'Team', layouts: layouts(4) })).toEqual({ idx: 1 })
  })
})
