import { fromAny } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

import { templateList } from '@/apps/slides/stores/presentation'

import { drawTemplateLayouts, firstLayout, setTemplateReader } from './templateLayouts'

// the real drawing pulls in the editor's upload setup, so a saved presentation here is its slides
vi.mock('@/apps/slides/collab/drawnDeck', () => ({
  drawnSlides: (saved: { slides: unknown[] }) => saved.slides,
}))
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

describe("a converted template's layouts", () => {
  it('are read again on the next need when the saved slides came back empty', async () => {
    templateList.value = fromAny([
      {
        name: 'team',
        node: 'node-team',
        title: 'Team',
        is_converted: true,
        thumbnails: [],
        layouts: [],
      },
    ])
    const read = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ slides: [{ clientId: 'layout', elements: [] }] })
    setTemplateReader(read)

    await drawTemplateLayouts(['team'])
    await drawTemplateLayouts(['team'])

    expect(read).toHaveBeenCalledTimes(2)
    expect(templateList.value[0].layouts).toHaveLength(1)
  })
})
