import { fromAny } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: (url: string) => url }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))
vi.mock('@/apps/slides/stores/elementRegistry', () => ({
  registerElementDiv: () => {},
  getElementDiv: () => null,
}))

// jsdom never loads an image, so every probe reports a square
class StubImage {
  naturalWidth = 100
  naturalHeight = 100
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}
vi.stubGlobal('Image', StubImage)

const { slides: storeSlides, slideIndex, getNewSlide } = await import('./slide')
// the store types each slide's fields as unknown, and these tests read them
const slides = fromAny<
  Ref<(Record<string, unknown> & { elements: Record<string, unknown>[] })[]>,
  unknown
>(storeSlides)
const { duplicateElements, replaceMediaElement } = await import('./element')
const { getTransitionKey } = await import('./transition')
const { resetImageCrop } = await import('./imageCrop')
const { setCommandHistory } = await import('./historyMeta')
const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')

const actionOrder = {
  execute: { editElement: ['execute'], batch: ['execute'] },
  undo: { editElement: ['undo'], batch: ['undo'] },
}

const image = (id: string, src: string, overrides = {}) => ({
  id,
  type: 'image',
  src,
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  ...overrides,
})

const seedSharedId = (overrides = {}) => {
  slides.value = [
    { clientId: 'c1', elements: [image('shared', '/files/first.webp', overrides)] },
    { clientId: 'c2', elements: [image('shared', '/files/second.webp', overrides)] },
  ]
  slideIndex.value = 1
  setCommandHistory(useCommandHistory(slides, { actionOrder, actions: {} }))
}

describe('a slide inserted from a layout', () => {
  it('takes fresh element ids so repeat inserts never collide', () => {
    const layout = { elements: JSON.stringify([image('fw89mlzl4', '/files/placeholder.webp')]) }

    const first = getNewSlide(false, { ...layout })
    const second = getNewSlide(false, { ...layout })

    expect(first.elements[0].id).not.toBe('fw89mlzl4')
    expect(second.elements[0].id).not.toBe(first.elements[0].id)
  })
})

describe('a duplicated slide', () => {
  it('keeps the transition of its source', () => {
    const source = {
      clientId: 'c1',
      elements: [],
      transition: 'Magic Move',
      transitionDuration: 2,
      fadeUnmatchedElements: 0,
    }

    const copy = getNewSlide(true, null, source)

    expect(copy.transition).toBe('Magic Move')
    expect(copy.transitionDuration).toBe(2)
    expect(copy.fadeUnmatchedElements).toBe(0)
  })
})

describe('replacing an image whose id repeats on an earlier slide', () => {
  beforeEach(() => seedSharedId())

  it('swaps the src of the element it was handed', async () => {
    await replaceMediaElement(slides.value[1].elements[0], {
      name: 'File-3',
      file_url: '/files/third.webp',
    })

    expect(slides.value[0].elements[0].src).toBe('/files/first.webp')
    expect(slides.value[1].elements[0].src).toBe('/files/third.webp')
  })
})

describe('resetting the crop of an image whose id repeats on an earlier slide', () => {
  const crop = { x: 0, y: 0, width: 0.5, height: 1 }

  beforeEach(() => seedSharedId({ crop }))

  it('clears the crop of the element it was handed', async () => {
    await resetImageCrop(slides.value[1].elements[0])

    expect(slides.value[0].elements[0].crop).toEqual(crop)
    expect(slides.value[1].elements[0].crop).toBeUndefined()
  })
})

// the show keys each element by `getTransitionKey`: Magic Move pairs equal keys across slides
describe('a copy of an element that pairs with the next slide', () => {
  const source = () => image('source', '/files/paired.webp', { refId: 'pair' })
  const keys = (at: number) => slides.value[at].elements.map(getTransitionKey)

  beforeEach(() => {
    slides.value = [
      { clientId: 'c1', transition: 'Magic Move', elements: [source()] },
      { clientId: 'c2', elements: [image('partner', '/files/paired.webp', { refId: 'pair' })] },
      { clientId: 'c3', elements: [] },
    ]
    slideIndex.value = 0
    setCommandHistory(useCommandHistory(slides, { actionOrder, actions: {} }))
  })

  it('never shares a key with its source on the same slide', async () => {
    await duplicateElements(null, [slides.value[0].elements[0]], 0)

    expect(new Set(keys(0)).size).toBe(2)
  })

  it('keeps its pairing when pasted back after a cut', async () => {
    const cut = slides.value[0].elements.pop()!

    await duplicateElements(null, [cut], 0, false)

    expect(keys(0)).toEqual(keys(1))
  })

  it('keeps its pairing when pasted on a slide with no element of that key', async () => {
    slideIndex.value = 2

    await duplicateElements(null, [source()], null)

    expect(keys(2)).toEqual(keys(1))
  })

  it('never shares a key with an element whose own id is that key', async () => {
    slides.value[2].elements = [image('pair', '/files/paired.webp')]
    slideIndex.value = 2

    await duplicateElements(null, [source()], null)

    expect(new Set(keys(2)).size).toBe(2)
  })

  it('never shares a numeric key with an element already on the slide', async () => {
    slides.value[2].elements = [image('partner', '/files/paired.webp', { refId: 7 })]
    slideIndex.value = 2

    await duplicateElements(null, [image('source', '/files/paired.webp', { refId: 7 })], null)

    expect(new Set(keys(2)).size).toBe(2)
  })

  it('keeps one pairing when two pasted elements carry it', async () => {
    slideIndex.value = 2

    await duplicateElements(null, [source(), source()], null)

    expect(new Set(keys(2)).size).toBe(2)
    expect(keys(2)).toContain('pair')
  })
})
