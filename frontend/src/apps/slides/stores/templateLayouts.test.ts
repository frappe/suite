import { fromAny } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { templateList } from '@/apps/slides/stores/presentation'

import {
  drawTemplateLayouts,
  firstLayout,
  setTemplateReader,
  templateMediaUrl,
} from './templateLayouts'

// what Drive lists as a node's media
const mediaList = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/api', () => ({
  api: { drive: { nodes: { media: 'nodes.media' } } },
  client: { query: mediaList.query },
}))

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

describe("a converted template's pictures", () => {
  function listed(name: string, elements: unknown[]) {
    templateList.value = fromAny([
      {
        name,
        node: `node-${name}`,
        title: name,
        is_converted: true,
        thumbnails: [],
        layouts: [],
      },
    ])
    setTemplateReader(async () => fromAny({ slides: [{ clientId: 'cover', elements }] }))
  }

  const signed = (stamp: string) => ({
    media: [{ node: 'photo', url: `/private/files/photo.png?signed=${stamp}` }],
  })

  afterEach(() => {
    vi.useRealTimers()
    mediaList.query.mockReset()
  })

  it("get their urls from the template's own media", async () => {
    listed('brand', [{ type: 'image', src: 'photo' }])
    mediaList.query.mockResolvedValue(signed('first'))

    await drawTemplateLayouts(['brand'])

    await vi.waitFor(() =>
      expect(templateMediaUrl('photo')).toBe('/private/files/photo.png?signed=first'),
    )
    expect(mediaList.query).toHaveBeenCalledWith('nodes.media', { node: 'node-brand' })
  })

  it('have no url when the template does not hold them', async () => {
    listed('borrowed', [{ type: 'image', src: 'elsewhere' }])
    mediaList.query.mockResolvedValue({ media: [] })

    await drawTemplateLayouts(['borrowed'])
    await vi.waitFor(() => expect(mediaList.query).toHaveBeenCalled())

    expect(templateMediaUrl('elsewhere')).toBe('')
  })

  it('get fresh urls once the signed ones have aged', async () => {
    vi.useFakeTimers()
    listed('aged', [{ type: 'image', src: 'photo' }])
    mediaList.query.mockResolvedValueOnce(signed('old')).mockResolvedValueOnce(signed('new'))

    await drawTemplateLayouts(['aged'])
    await drawTemplateLayouts(['aged'])
    expect(mediaList.query).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 11 * 60_000)
    await drawTemplateLayouts(['aged'])

    await vi.waitFor(() =>
      expect(templateMediaUrl('photo')).toBe('/private/files/photo.png?signed=new'),
    )
  })

  it('are not asked for when no layout names one', async () => {
    listed('plain', [{ type: 'text', content: '<p>Title</p>' }])

    await drawTemplateLayouts(['plain'])

    expect(mediaList.query).not.toHaveBeenCalled()
  })
})
