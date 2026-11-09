import { afterEach, describe, expect, it, vi } from 'vitest'

import { keepImages, previewImage, releaseImages } from './imageCache'

/** The addresses the cache starts loading while `run` runs. */
function loadedDuring(run: () => void): string[] {
  const create = vi.spyOn(document, 'createElement')
  run()
  const loaded = create.mock.results.flatMap(({ value }) =>
    value instanceof HTMLImageElement ? [value.src] : [],
  )
  create.mockRestore()
  return loaded
}

const address = (path: string) => new URL(path, document.baseURI).href

describe('preview image cache', () => {
  afterEach(async () => {
    releaseImages()
    await Promise.resolve()
  })

  it('loads the pictures beside once the one on screen has loaded', () => {
    expect(loadedDuring(() => keepImages('/open.png', ['/next.png']))).toEqual([
      address('/open.png'),
    ])

    const shown = previewImage('/open.png')

    expect(loadedDuring(() => shown.dispatchEvent(new Event('load')))).toEqual([
      address('/next.png'),
    ])
  })

  it('does not load the pictures beside after the preview has closed', async () => {
    keepImages('/closing.png', ['/beside.png'])
    const shown = previewImage('/closing.png')

    releaseImages()
    await Promise.resolve()

    expect(loadedDuring(() => shown.dispatchEvent(new Event('load')))).toEqual([])
  })

  it('keeps a picture across a step, where the next preview takes over in the same tick', async () => {
    keepImages('/first.png', ['/second.png'])
    const first = previewImage('/first.png')

    releaseImages()
    keepImages('/second.png', ['/first.png'])
    await Promise.resolve()

    expect(previewImage('/first.png')).toBe(first)
  })
})
