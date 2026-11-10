import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import {
  cache,
  DECLARED_FONTS,
  ENTRY_ASSETS,
  image,
  LAZY_CHUNK,
  presentationDoc,
  presentationId,
  recordedKeys,
  recordOf,
  responses,
  SHELL_HTML,
  shellResponse,
  slides,
  slidesWith,
  STARTUP_API,
  startupFetched,
  state,
  statusOf,
  viewOnly,
} from './offlineCopy.fakes'

const {
  saveOfflineCopy,
  removeOfflineCopy,
  removeNodeOfflineCopy,
  refreshOfflineStatus,
  warmOfflineCopyAssets,
  offlineCopyProgress,
  offlineCopyStatus,
} = await import('./offlineCopy')
const { setDocumentMedia } = await import('@/apps/slides/stores/documentMedia')

describe('offline status', () => {
  it('is none without a record', () => {
    expect(statusOf('p1')).toBe('none')
  })

  it('is available after a full run', async () => {
    await saveOfflineCopy('p1')
    expect(statusOf('p1')).toBe('available')
  })

  it('is outdated once the presentation points at other files', async () => {
    await saveOfflineCopy('p1')
    slides.value = slidesWith(['/files/a.png'], ['/files/new.png'])
    expect(statusOf('p1')).toBe('outdated')
  })

  it('stays available when only text changed', async () => {
    await saveOfflineCopy('p1')
    presentationDoc.value = { ...presentationDoc.value, modified: '2026-08-17 11:00:00' }
    expect(statusOf('p1')).toBe('available')
  })

  it('answers only for the open presentation', async () => {
    await saveOfflineCopy('p1')
    presentationId.value = 'p2'
    expect(statusOf('p1')).toBe('none')
  })

  describe('a picture named by its Drive node', () => {
    const picture = '/private/files/m1.png?signature=s1'
    let release: (() => void) | null = null
    const src = ref<string | null>(null)
    const status = ref<'loading' | 'unanswered' | 'ready' | 'refused'>('loading')

    function driveAnswers(url: string | null, answer: 'unanswered' | 'ready' | 'refused') {
      src.value = url
      status.value = answer
    }

    async function settled() {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    beforeEach(() => {
      src.value = null
      status.value = 'loading'
      release = setDocumentMedia((id) => ({
        id,
        src,
        status,
        cacheKey: ref(id),
        refresh: async () => {},
      }))
      slides.value = slidesWith(['/files/a.png'])
    })

    afterEach(() => {
      release?.()
    })

    it('is outdated once Drive signs one added since the pin', async () => {
      await saveOfflineCopy('p1')
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])

      refreshOfflineStatus('p1')
      driveAnswers(picture, 'ready')
      await settled()

      expect(offlineCopyStatus.value).toBe('outdated')
    })

    it('is outdated offline when the list it holds has no row for one', async () => {
      await saveOfflineCopy('p1')
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])
      vi.stubGlobal('navigator', { ...navigator, onLine: false })

      refreshOfflineStatus('p1')
      driveAnswers(null, 'refused')
      await settled()

      expect(offlineCopyStatus.value).toBe('outdated')
    })

    it('stays available online when Drive refuses one, as no update could add it', async () => {
      await saveOfflineCopy('p1')
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])

      refreshOfflineStatus('p1')
      driveAnswers(null, 'refused')
      await settled()

      expect(offlineCopyStatus.value).toBe('available')
    })

    it('keeps its status while the first read is still out', async () => {
      await saveOfflineCopy('p1')
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])

      refreshOfflineStatus('p1')
      await settled()

      expect(offlineCopyStatus.value).toBe('available')
    })

    it('does not claim to be available on a picture no read has answered for', async () => {
      await saveOfflineCopy('p1')
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])
      refreshOfflineStatus('p1')

      driveAnswers(null, 'unanswered')
      await settled()

      expect(offlineCopyStatus.value).toBe('outdated')
    })

    it('is available again once a read answers for a picture the pin holds', async () => {
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])
      responses[picture] = () => image(30)
      driveAnswers(picture, 'ready')
      await saveOfflineCopy('p1')
      driveAnswers(null, 'unanswered')
      refreshOfflineStatus('p1')

      driveAnswers(picture, 'ready')
      await settled()

      expect(offlineCopyStatus.value).toBe('available')
    })

    it('waits for a read to answer for a picture before saving without it', async () => {
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])
      responses[picture] = () => image(30)
      driveAnswers(null, 'unanswered')

      const saving = saveOfflineCopy('p1')
      await settled()
      driveAnswers(picture, 'ready')

      expect(await saving).toEqual({ ok: true, failed: [], count: 2 })
    })

    it('follows a later read with no change to the slides', async () => {
      await saveOfflineCopy('p1')
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])
      refreshOfflineStatus('p1')
      driveAnswers(null, 'refused')
      await settled()

      driveAnswers(picture, 'ready')
      await settled()

      expect(offlineCopyStatus.value).toBe('outdated')
    })

    it('stays available once Drive signs one the pin holds', async () => {
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])
      responses[picture] = () => image(30)
      driveAnswers(picture, 'ready')
      await saveOfflineCopy('p1')
      status.value = 'loading'
      src.value = null

      refreshOfflineStatus('p1')
      driveAnswers(picture, 'ready')
      await settled()

      expect(offlineCopyStatus.value).toBe('available')
    })

    it('leaves the status of the presentation opened since alone', async () => {
      await saveOfflineCopy('p1')
      presentationId.value = 'p2'
      await saveOfflineCopy('p2')
      presentationId.value = 'p1'
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])
      refreshOfflineStatus('p1')

      presentationId.value = 'p2'
      slides.value = slidesWith(['/files/a.png'])
      refreshOfflineStatus('p2')
      driveAnswers(picture, 'ready')
      await settled()

      expect(offlineCopyStatus.value).toBe('available')
    })
  })
})

// what opening the presentation at /d/<node> offline needs (DESIGN-slides-offline §3)
describe('the start-up copy', () => {
  describe('of a composite whose viewer leaves during the run', () => {
    function compositeKey(id: string) {
      return recordOf(id).keys.filter((key: string) => key.includes('composite'))
    }

    afterEach(() => {
      viewOnly.value = false
    })

    it.each([
      ['a save', 'l1', (id: string) => saveOfflineCopy(id)],
      ['a visit', 'l2', (id: string) => warmOfflineCopyAssets(id)],
    ])('keeps the composite file through %s', async (_label, id, runIt) => {
      viewOnly.value = true
      presentationDoc.value = { node: 'n1', is_composite: 1, modified: '2026-08-17 10:00:00' }
      presentationId.value = id
      await saveOfflineCopy(id)
      const held = compositeKey(id)
      expect(held).toHaveLength(1)
      const { promise: answered, resolve: answer } = Promise.withResolvers<void>()
      const next = fetch
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url === '/d/n1') {
          await answered
        }

        return next(url, init)
      })

      const running = runIt(id)
      await new Promise((resolve) => setTimeout(resolve, 0))
      presentationDoc.value = null
      presentationId.value = fromPartial(null)
      viewOnly.value = false
      answer()
      await running

      expect(compositeKey(id)).toEqual(held)
      expect(cache.has(held[0])).toBe(true)
    })
  })

  it('stores the shell once under /d/<node>, whichever view the pin starts from', async () => {
    history.replaceState(null, '', '/d/n1/present')

    await saveOfflineCopy('p1')

    expect(startupFetched.filter((url) => url.startsWith('/d/'))).toEqual(['/d/n1'])
    expect(await cache.text('/d/n1')).toBe(SHELL_HTML)
    history.replaceState(null, '', '/')
  })

  it("stores the start-up reads and the page's assets, and lists every key with the node", async () => {
    await saveOfflineCopy('p1')

    const keys = [
      '/d/n1',
      ...STARTUP_API,
      ...ENTRY_ASSETS,
      LAZY_CHUNK,
      ...DECLARED_FONTS,
      '/private/files/a.png',
      '/private/files/b.png',
    ]
    for (const key of keys) {
      expect(cache.has(key)).toBe(true)
    }

    expect(recordOf('p1').node).toBe('n1')
    expect(recordOf('p1').keys.sort()).toEqual([...keys].sort())
  })

  it.each([
    ['a guest shell', () => shellResponse({ 'X-Suite-Guest': '1' })],
    ['a shell from another build', () => shellResponse({ 'X-Suite-Build': '200' })],
    ['a missing page', () => shellResponse({}, 404)],
    [
      'a redirected shell',
      () => {
        const response = shellResponse()
        Object.defineProperty(response, 'redirected', { value: true })
        return response
      },
    ],
  ])('stores nothing and fails the pin for %s', async (_label, make) => {
    state.shell = make

    await expect(saveOfflineCopy('p1')).rejects.toThrow()

    expect(cache.store.size).toBe(0)
    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
    expect(offlineCopyProgress.value.running).toBe(false)
  })

  it.each([STARTUP_API[0], ENTRY_ASSETS[0]])(
    'fails the save and stores nothing when %s fails',
    async (failing) => {
      const next = globalThis.fetch
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url === failing) {
          return json(500)
        }

        return next(url, init)
      })

      await expect(saveOfflineCopy('p1')).rejects.toThrow()

      expect(cache.store.size).toBe(0)
      expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
    },
  )

  it.each([
    ['a save', 'q1', (id: string) => saveOfflineCopy(id)],
    ['a visit', 'q2', (id: string) => warmOfflineCopyAssets(id)],
  ])('fails %s on a full disk, keeping every stored key listed', async (_label, id, run) => {
    await saveOfflineCopy(id)
    const before = recordOf(id).keys
    state.shell = () => shellResponse({}, 200, SHELL_HTML.replaceAll('index-a1', 'index-e5'))
    const put = cache.put.bind(cache)
    cache.put = async (key, response) => {
      if (key.includes('index-e5')) {
        throw new DOMException('full', 'QuotaExceededError')
      }

      return put(key, response)
    }

    await expect(run(id)).rejects.toThrow()

    const stored = [...cache.store.keys()].map((href) => {
      const url = new URL(href)
      return url.pathname + url.search
    })
    expect(recordOf(id).keys).toEqual(before)
    expect(stored.filter((key) => !before.includes(key))).toEqual([])
  })

  it.each([
    ['a save', 'q3', (id: string) => saveOfflineCopy(id)],
    ['a visit', 'q4', (id: string) => warmOfflineCopyAssets(id)],
  ])('rolls back %s only after its slower stores land', async (_label, id, run) => {
    await saveOfflineCopy(id)
    const before = recordOf(id).keys
    state.shell = () =>
      shellResponse(
        {},
        200,
        SHELL_HTML.replaceAll('index-a1', 'index-e5').replaceAll('index-c3', 'index-f6'),
      )
    const { promise: landing, resolve: land } = Promise.withResolvers<void>()
    const { promise: storing, resolve: stored } = Promise.withResolvers<void>()
    const put = cache.put.bind(cache)
    cache.put = async (key, response) => {
      if (key.includes('index-e5')) {
        throw new DOMException('full', 'QuotaExceededError')
      }

      if (key.includes('index-f6')) {
        stored()
        await landing
      }

      return put(key, response)
    }

    const running = run(id).catch((err) => err)
    await storing
    await new Promise((resolve) => setTimeout(resolve, 0))
    land()
    const failure = await running
    await new Promise((resolve) => setTimeout(resolve, 0))

    const keys = [...cache.store.keys()].map((href) => {
      const url = new URL(href)
      return url.pathname + url.search
    })
    expect(failure).toBeInstanceOf(DOMException)
    expect(recordOf(id).keys).toEqual(before)
    expect(keys.filter((key) => !before.includes(key))).toEqual([])
  })

  it('removes the shell, the reads and the assets with the copy', async () => {
    await saveOfflineCopy('p1')

    await removeOfflineCopy('p1')

    expect(cache.store.size).toBe(0)
  })

  it('removes the copy of a node and leaves the others', async () => {
    await saveOfflineCopy('p1')
    presentationDoc.value = { ...presentationDoc.value, node: 'n2' }
    presentationId.value = 'p2'
    await saveOfflineCopy('p2')

    await removeNodeOfflineCopy('n1')

    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
    expect(cache.has('/d/n1')).toBe(false)
    expect(recordOf('p2').node).toBe('n2')
    expect(cache.has('/d/n2')).toBe(true)
    expect(cache.has('/private/files/a.png')).toBe(true)
  })

  it('refreshes the shell and its assets on an online visit, dropping the old build', async () => {
    await saveOfflineCopy('p1')
    const html = SHELL_HTML.replaceAll('index-a1', 'index-e5')
    state.shell = () => shellResponse({ 'X-Suite-Build': '100' }, 200, html)

    await warmOfflineCopyAssets('p1')

    expect(await cache.text('/d/n1')).toBe(html)
    expect(cache.has('/assets/suite/frontend/assets/index-e5.js')).toBe(true)
    expect(cache.has('/assets/suite/frontend/assets/index-a1.js')).toBe(false)
    expect(recordOf('p1').keys).toContain('/assets/suite/frontend/assets/index-e5.js')
    expect(recordedKeys('p1')).toEqual(['/private/files/a.png', '/private/files/b.png'])
  })

  it.each([
    ['the node is forgotten', 'f1', () => removeNodeOfflineCopy('n1')],
    ['the copy is removed', 'f3', (id: string) => removeOfflineCopy(id)],
  ])('leaves no record and no shell when %s during a visit', async (_label, id, remove) => {
    await saveOfflineCopy(id)
    const { promise: answered, resolve: answer } = Promise.withResolvers<void>()
    const next = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/d/n1') {
        await answered
      }

      return next(url, init)
    })

    const warming = warmOfflineCopyAssets(id)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await remove(id)
    answer()
    await warming

    expect(localStorage.getItem(`slides-offline-copy:${id}`)).toBeNull()
    expect(cache.has('/d/n1')).toBe(false)
    expect(cache.store.size).toBe(0)
  })

  it.each([
    ['its node is forgotten', 'f2', () => removeNodeOfflineCopy('n1')],
    ['its copy is removed', 'f4', (id: string) => removeOfflineCopy(id)],
  ])('stops a save when %s, leaving nothing behind', async (_label, id, remove) => {
    let removing: Promise<void> | undefined
    responses['/private/files/b.png?slides_media=1'] = () => {
      removing = remove(id)
      return image(20)
    }

    const result = await saveOfflineCopy(id)
    await removing

    expect(result).toBeNull()
    expect(localStorage.getItem(`slides-offline-copy:${id}`)).toBeNull()
    expect(cache.store.size).toBe(0)
  })

  it("keeps the old shell when the new build's assets can't be stored", async () => {
    await saveOfflineCopy('s1')
    state.shell = () => shellResponse({}, 200, SHELL_HTML.replaceAll('index-a1', 'index-e5'))
    const put = cache.put.bind(cache)
    cache.put = async (key, response) => {
      if (key.includes('index-e5')) {
        throw new DOMException('full', 'QuotaExceededError')
      }

      return put(key, response)
    }

    await expect(warmOfflineCopyAssets('s1')).rejects.toThrow('full')

    expect(await cache.text('/d/n1')).toBe(SHELL_HTML)
    expect(cache.has('/assets/suite/frontend/assets/index-a1.js')).toBe(true)
    expect(recordOf('s1').keys).toContain('/assets/suite/frontend/assets/index-a1.js')
  })

  it("keeps the old shell and drops the new build's assets when the shell can't be stored", async () => {
    await saveOfflineCopy('s2')
    state.shell = () => shellResponse({}, 200, SHELL_HTML.replaceAll('index-a1', 'index-e5'))
    const put = cache.put.bind(cache)
    cache.put = async (key, response) => {
      if (key === '/d/n1') {
        throw new DOMException('full', 'QuotaExceededError')
      }

      return put(key, response)
    }

    await expect(warmOfflineCopyAssets('s2')).rejects.toThrow('full')

    expect(await cache.text('/d/n1')).toBe(SHELL_HTML)
    expect(cache.has('/assets/suite/frontend/assets/index-a1.js')).toBe(true)
    expect(recordOf('s2').keys).toContain('/assets/suite/frontend/assets/index-a1.js')
    expect(cache.has('/assets/suite/frontend/assets/index-e5.js')).toBe(false)
  })

  it('writes nothing back when a visit stored its copy after an unpin and a failed re-pin', async () => {
    await saveOfflineCopy('o1')
    state.shell = () => shellResponse({}, 200, SHELL_HTML.replaceAll('index-a1', 'index-e5'))
    const { promise: landed, resolve: land } = Promise.withResolvers<void>()
    const { promise: reached, resolve: reach } = Promise.withResolvers<void>()
    const put = cache.put.bind(cache)
    let isHeld = false
    cache.put = async (key, response) => {
      if (key === '/d/n1' && !isHeld) {
        isHeld = true
        reach()
        await landed
      }

      return put(key, response)
    }

    const warming = warmOfflineCopyAssets('o1')
    await reached
    await removeOfflineCopy('o1')
    state.shell = () => shellResponse({ 'X-Suite-Build': '200' })
    const saving = saveOfflineCopy('o1')
    land()
    await warming

    await expect(saving).rejects.toThrow('could not be stored')
    expect(localStorage.getItem('slides-offline-copy:o1')).toBeNull()
    expect([...cache.store.keys()]).toEqual([])
  })

  it('keeps every picture a save stores while a visit is still refreshing', async () => {
    slides.value = slidesWith(['/files/a.png'])
    await saveOfflineCopy('w1')
    slides.value = slidesWith(['/files/a.png'], ['/files/b.png'])
    const { promise: answered, resolve: answer } = Promise.withResolvers<void>()
    const next = globalThis.fetch
    let isHeld = false
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/d/n1' && !isHeld) {
        isHeld = true
        await answered
      }

      return next(url, init)
    })

    const warming = warmOfflineCopyAssets('w1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const saving = saveOfflineCopy('w1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    answer()
    await Promise.all([warming, saving])

    expect(recordedKeys('w1')).toEqual(['/private/files/a.png', '/private/files/b.png'])
  })

  it('asks again on a visit once a picture is added, and for nothing else', async () => {
    const list = '/api/suite/drive/nodes/n1/media'
    await saveOfflineCopy('a1')
    await warmOfflineCopyAssets('a1')
    await warmOfflineCopyAssets('a1')
    const keysBefore = recordOf('a1').keys
    const asked = startupFetched.filter((url) => url === list).length

    slides.value = [...slides.value, ...slidesWith(['node1234'])]
    await warmOfflineCopyAssets('a1')
    await warmOfflineCopyAssets('a1')

    expect(startupFetched.filter((url) => url === list).length).toBe(asked + 1)
    expect(recordOf('a1').keys).toEqual(keysBefore)
    expect(localStorage.getItem('slides-offline-copy:a1')).toContain('"node":"n1"')
  })

  it('refreshes nothing for a presentation with no offline copy', async () => {
    await warmOfflineCopyAssets('p1')

    expect(startupFetched).toEqual([])
    expect(cache.store.size).toBe(0)
  })
})
