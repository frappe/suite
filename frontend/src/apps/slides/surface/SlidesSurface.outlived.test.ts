import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import {
  fakeServer,
  openedSurface,
  saves,
  served,
  server,
  startsFromEmptyStore,
  thumbnails,
} from './SlidesSurface.fakes'

const { duplicateSlide, slides: editorSlides } = await import('@/apps/slides/stores/slide')
const { isSaving, saveFailed, savingFor, writeDraft } = await import('@/apps/slides/stores/saving')
const { keepRecovery, readRecovery } = await import('./recovery')

let mounted: Awaited<ReturnType<typeof openedSurface>> | null = null

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = null
  saves.length = 0
  server.fetch.mockReset()
})

describe('a copy that outlived its page', () => {
  startsFromEmptyStore()

  const rows = [
    {
      name: 'row-1',
      client_id: 'c1',
      background: '#FFF',
      elements: JSON.stringify([
        { id: 'e1', type: 'shape', shapeType: 'circle', fillColor: 'red', top: 1, left: 2 },
      ]),
      transition: null,
      transition_duration: '0.5',
      fade_unmatched_elements: 0,
      advance_after: null,
    },
  ]

  async function saveLanded(count: number) {
    await vi.waitFor(() => expect(saves.length).toBeGreaterThanOrEqual(count), { timeout: 3000 })
    await vi.waitFor(() => expect(isSaving.value).toBe(false))
    await nextTick()
  }

  async function closedAndSettled() {
    mounted?.app.unmount()
    mounted = null
    // the unmount sends what it holds, and that landing must not reach the next open
    await new Promise((resolve) => setTimeout(resolve, 50))
    await vi.waitFor(() => expect(savingFor.value).toBeNull())
    saves.length = 0
  }

  // the copy a closing page keeps, with what its push had sent by then
  async function closedWithCopy() {
    mounted = await openedSurface({ slides: rows })
    duplicateSlide()
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    const [copy] = readRecovery('node-1')
    expect(copy.sticky).toBe(false)
    await saveLanded(1)
    const sent = savedSlides(saves[0])
    await closedAndSettled()
    localStorage.clear()
    return { copy, sent }
  }

  it('opens over a copy it cannot compare, and keeps the copy', async () => {
    keepRecovery('node-1', [null])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mounted = await openedSurface()
    await nextTick()

    expect(warn).toHaveBeenCalled()
    expect(thumbnails(mounted.root)).toHaveLength(served.slides.length)
    expect(readRecovery('node-1')).toEqual([
      expect.objectContaining({ slides: [null], sticky: true }),
    ])
    await closedAndSettled()
  })

  it('keeps a copy that differs from the load through the first landed save', async () => {
    keepRecovery('node-1', [{ clientId: 'gone', background: '#000000ff', elements: [] }])
    mounted = await openedSurface()
    const [kept] = readRecovery('node-1')
    expect(kept.sticky).toBe(true)

    duplicateSlide()
    await saveLanded(1)

    expect(readRecovery('node-1')).toHaveLength(1)
  })

  it.each<[string, 'server' | 'draft']>([
    ['the server took its push', 'server'],
    ['its draft restores', 'draft'],
  ])('clears a copy with the same content when %s', async (_name, route) => {
    const { copy, sent } = await closedWithCopy()
    keepRecovery('node-1', copy.slides)
    if (route === 'draft') {
      const nextOpen = fakeServer.opens + 1
      await writeDraft({
        id: `p${nextOpen}`,
        content: copy.slides,
        dirty: true,
        updatedAt: 1,
        baseModified: 'M1',
      })
    }

    // what the server stores: each row gets a name, and numbers come back as strings
    const stored = sent.map((row, position) => ({
      ...row,
      name: row.client_id,
      idx: position + 1,
      transition_duration: String(row.transition_duration),
    }))
    mounted = await openedSurface({ slides: stored })
    await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
    const [same] = readRecovery('node-1')
    expect(same.sticky).toBe(false)

    duplicateSlide()
    await saveLanded(1)

    expect(readRecovery('node-1')).toEqual([])
  })

  it('still clears a same-page copy on the next landed save after the first', async () => {
    mounted = await openedSurface()
    duplicateSlide()
    await saveLanded(1)
    duplicateSlide()
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    const [ownPage] = readRecovery('node-1')
    expect(ownPage.sticky).toBe(false)

    await saveLanded(2)

    expect(readRecovery('node-1')).toEqual([])
  })

  it('holds off a landing from the last surface until the first load has compared', async () => {
    keepRecovery('node-1', [{ clientId: 'gone', background: '#000000ff', elements: [] }])
    let release!: () => void
    mounted = await openedSurface({
      firstLoad: new Promise<void>((resolve) => {
        release = resolve
      }),
    })
    saveFailed.value = false
    savingFor.value = mounted.docname
    await nextTick()
    savingFor.value = null
    await nextTick()

    release()
    await vi.waitFor(() =>
      expect(thumbnails(requireTestElement(mounted?.root, Element))).toHaveLength(2),
    )

    const [held] = readRecovery('node-1')
    expect(held.sticky).toBe(true)
  })

  it('leaves a copy alone when the surface goes before its first load ends', async () => {
    keepRecovery('node-1', [{ clientId: 'gone' }])
    let release!: () => void
    mounted = await openedSurface({
      firstLoad: new Promise<void>((resolve) => {
        release = resolve
      }),
    })

    mounted.app.unmount()
    mounted = null
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const [untouched] = readRecovery('node-1')
    expect(untouched.sticky).toBe(false)
  })
})

function requireTestElement<T extends Element>(
  value: unknown,
  constructor: new (...args: never[]) => T,
): T {
  if (!(value instanceof constructor)) throw new Error(`Expected ${constructor.name}`)
  return value
}

function savedSlides(value: unknown) {
  if (!value || typeof value !== 'object' || !('slides' in value) || !Array.isArray(value.slides))
    throw new Error('Expected a saved slide array')
  return value.slides.map((slide: unknown) => {
    if (!isSavedSlide(slide)) throw new Error('Expected serialized slide elements')
    return slide
  })
}

interface SavedSlidePayload {
  elements: string
  [key: string]: unknown
}
function isSavedSlide(value: unknown): value is SavedSlidePayload {
  return (
    !!value &&
    typeof value === 'object' &&
    'elements' in value &&
    typeof value.elements === 'string'
  )
}
