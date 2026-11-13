import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import {
  cache,
  DECLARED_FONTS,
  deletedCaches,
  FakeCache,
  fetched,
  image,
  presentationDoc,
  presentationId,
  recordedKeys,
  recordOf,
  responses,
  SHELL_HTML,
  shellResponse,
  slides,
  slideshowChunkLoads,
  slidesWith,
  STARTUP_API,
  startupFetched,
  state,
  statusOf,
} from './offlineCopy.fakes'

const {
  saveOfflineCopy,
  pruneOfflineCopy,
  cancelOfflineCopy,
  removeOfflineCopy,
  removeNodeOfflineCopy,
  removeRowedOfflineCopy,
  refreshOfflineStatus,
  warmOfflineCopyAssets,
  offlineCopyProgress,
  offlineCopyStatus,
} = await import('./offlineCopy')
const { setDocumentMedia } = await import('@/apps/slides/stores/documentMedia')

describe('saveOfflineCopy', () => {
  it('stores every media file under its canonical key and records the run', async () => {
    const result = await saveOfflineCopy('p1')

    expect(result).toEqual({ ok: true, failed: [], count: 2 })
    expect(cache.has('/private/files/a.png')).toBe(true)
    expect(cache.has('/private/files/b.png')).toBe(true)
    expect(recordedKeys('p1')).toEqual(['/private/files/a.png', '/private/files/b.png'])
    expect(offlineCopyProgress.value).toMatchObject({ running: false, done: 2, total: 2 })
  })

  it('waits for Drive to sign a node-id picture before collecting it', async () => {
    const src = ref<string | null>(null)
    const status = ref<'loading' | 'ready' | 'refused'>('loading')
    const release = setDocumentMedia((id) => ({
      id,
      src,
      status,
      cacheKey: ref(id),
      refresh: async () => {},
    }))
    slides.value = slidesWith(['/files/a.png', 'media-node-1'])
    responses['/private/files/m1.png?signature=s1'] = () => image(30)

    const saving = saveOfflineCopy('p1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    src.value = '/private/files/m1.png?signature=s1'
    status.value = 'ready'
    const result = await saving
    release()

    expect(result).toEqual({ ok: true, failed: [], count: 2 })
    expect(cache.has('/private/files/m1.png')).toBe(true)
    expect(recordedKeys('p1')).toEqual(['/private/files/a.png', '/private/files/m1.png'])
  })

  it('reports a picture Drive refused as not saved, without waiting for it', async () => {
    const release = setDocumentMedia((id) => ({
      id,
      src: ref(null),
      status: ref('refused' as const),
      cacheKey: ref(id),
      refresh: async () => {},
    }))
    slides.value = slidesWith(['/files/a.png', 'media-node-1'])

    const result = await saveOfflineCopy('p1')
    release()

    expect(result).toEqual({
      ok: false,
      failed: [{ slideIndex: 0, src: 'media-node-1', status: 'refused' }],
      count: 2,
    })
    expect(recordedKeys('p1')).toEqual(['/private/files/a.png'])
  })

  it('asks Drive again for a picture still waiting rather than sitting out the wait', async () => {
    responses['/private/files/m1.png?signature=s1'] = () => image(30)
    const src = ref<string | null>(null)
    const status = ref<'loading' | 'ready'>('loading')
    const release = setDocumentMedia((id) => ({
      id,
      src,
      status,
      cacheKey: ref(id),
      async refresh() {
        src.value = '/private/files/m1.png?signature=s1'
        status.value = 'ready'
      },
    }))
    slides.value = slidesWith(['/files/a.png', 'media-node-1'])

    const result = await saveOfflineCopy('p1')
    release()

    expect(result).toEqual({ ok: true, failed: [], count: 2 })
  })

  it('loads the slideshow chunk so present works offline', async () => {
    await saveOfflineCopy('p1')

    expect(slideshowChunkLoads).toBe(1)
  })

  it('refuses to run from a page the worker does not control', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: { controller: null, addEventListener: () => {}, ready: new Promise(() => {}) },
    })

    const run = saveOfflineCopy('p1')
    await vi.runAllTimersAsync()
    const result = await run
    vi.useRealTimers()

    expect(result).toEqual({ ok: false, uncontrolled: true, registered: false })
    expect(fetched).toEqual([])
    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
  })

  it('skips files that are already pinned', async () => {
    await cache.put('/private/files/a.png', image())

    await saveOfflineCopy('p1')

    expect(fetched).toEqual(['/private/files/b.png?slides_media=1'])
  })

  it('collects failures by slide and keeps going', async () => {
    responses['/private/files/a.png?slides_media=1'] = () =>
      new Response('nope', { status: 403, headers: { 'Content-Type': 'text/html' } })

    const result = await saveOfflineCopy('p1')

    expect(result).toMatchObject({
      ok: false,
      failed: [{ slideIndex: 0, src: '/files/a.png', status: 403 }],
    })
    expect(cache.has('/private/files/a.png')).toBe(false)
    expect(cache.has('/private/files/b.png')).toBe(true)
    expect(recordedKeys('p1')).toEqual(['/private/files/b.png'])
  })

  it('retries a network failure before recording it', async () => {
    vi.useFakeTimers()
    let attempts = 0
    responses['/private/files/a.png?slides_media=1'] = () => {
      attempts += 1
      return attempts < 3 ? new Error('offline') : image()
    }

    const run = saveOfflineCopy('p1')
    await vi.runAllTimersAsync()
    const result = await run
    vi.useRealTimers()

    expect(attempts).toBe(3)
    expect(result?.ok).toBe(true)
  })

  it('retries a server error like a dropped connection', async () => {
    vi.useFakeTimers()
    let attempts = 0
    responses['/private/files/a.png?slides_media=1'] = () => {
      attempts += 1
      return attempts < 2 ? new Response('', { status: 503 }) : image()
    }

    const run = saveOfflineCopy('p1')
    await vi.runAllTimersAsync()
    const result = await run
    vi.useRealTimers()

    expect(attempts).toBe(2)
    expect(result?.ok).toBe(true)
  })

  it('keeps the ledger current when cancelled, so the run can be finished later', async () => {
    responses['/private/files/b.png?slides_media=1'] = () => {
      cancelOfflineCopy()
      return image(20)
    }

    const result = await saveOfflineCopy('p1')

    expect(result).toBeNull()
    expect(recordedKeys('p1')).toEqual(['/private/files/a.png'])
    expect(statusOf('p1')).toBe('outdated')
  })

  it('stops at the first quota error and reports it', async () => {
    const put = cache.put.bind(cache)
    cache.put = async (key, response) => {
      if (!key.startsWith('/private/files/')) {
        return put(key, response)
      }
      throw new DOMException('full', 'QuotaExceededError')
    }

    const result = await saveOfflineCopy('p1')

    expect(result?.ok).toBe(false)
    expect(result?.failed).toEqual([{ slideIndex: 0, src: '/files/a.png', status: 'quota' }])
    expect(recordedKeys('p1')).toEqual([])
  })

  it('ends a save cancelled before Drive has signed its pictures', async () => {
    const release = setDocumentMedia((id) => ({
      id,
      src: ref(null),
      status: ref('loading' as const),
      cacheKey: ref(id),
      refresh: async () => {},
    }))
    slides.value = slidesWith(['/files/a.png', 'media-node-1'])

    const saving = saveOfflineCopy('p1')
    cancelOfflineCopy()
    const result = await saving
    release()

    expect(result).toBeNull()
    expect(offlineCopyProgress.value.running).toBe(false)
    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
  })

  it('reports a picture Drive has not signed after 30 seconds as not saved', async () => {
    vi.useFakeTimers()
    const release = setDocumentMedia((id) => ({
      id,
      src: ref(null),
      status: ref('loading' as const),
      cacheKey: ref(id),
      refresh: async () => {},
    }))
    slides.value = slidesWith(['/files/a.png'], ['media-node-1'])

    const saving = saveOfflineCopy('p1')
    await vi.advanceTimersByTimeAsync(30_000)
    const result = await saving
    release()
    vi.useRealTimers()

    expect(result).toEqual({
      ok: false,
      failed: [{ slideIndex: 1, src: 'media-node-1', status: 'timeout' }],
      count: 2,
    })
  })

  it('surfaces a ledger write failure, so the button can report it', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    await expect(saveOfflineCopy('p1')).rejects.toThrow()
    expect(offlineCopyProgress.value.running).toBe(false)
    setItem.mockRestore()
  })

  it('leaves the images the presentation no longer shows for the next open to clear', async () => {
    await saveOfflineCopy('p1')
    slides.value = slidesWith(['/files/b.png'])

    await saveOfflineCopy('p1')

    expect(cache.has('/private/files/a.png')).toBe(true)
    expect(recordedKeys('p1')).toContain('/private/files/a.png')

    await pruneOfflineCopy('p1')

    expect(cache.has('/private/files/a.png')).toBe(false)
    expect(recordedKeys('p1')).toEqual(['/private/files/b.png'])
  })

  describe('when the presentation goes away during the wait for a picture', () => {
    const copied = ['/private/files/a.png', '/private/files/b.png']

    async function savedThenGoesAway(goAway: () => void) {
      await saveOfflineCopy('p1')
      const src = ref<string | null>(null)
      const status = ref<'loading' | 'ready'>('loading')
      const release = setDocumentMedia((id) => ({
        id,
        src,
        status,
        cacheKey: ref(id),
        refresh: async () => {},
      }))
      slides.value = slidesWith(['/files/a.png'], ['/files/b.png'], ['media-node-1'])

      const saving = saveOfflineCopy('p1')
      await new Promise((resolve) => setTimeout(resolve, 0))
      goAway()
      status.value = 'ready'
      await saving
      release()
    }

    it('keeps the copy and its record when another presentation opens', async () => {
      responses['/private/files/other.png?slides_media=1'] = () => image(40)

      await savedThenGoesAway(() => {
        presentationDoc.value = { node: 'n2', is_composite: 0, modified: '2026-08-17 10:00:00' }
        presentationId.value = 'p2'
        slides.value = slidesWith(['/files/other.png'])
      })

      expect(copied.every((key) => cache.has(key))).toBe(true)
      expect(cache.has('/private/files/other.png')).toBe(false)
      expect(recordedKeys('p1')).toEqual(copied)
    })

    it('keeps the copy and its record when the editor is left', async () => {
      await savedThenGoesAway(() => {
        presentationDoc.value = null
        presentationId.value = null
        slides.value = []
      })

      expect(copied.every((key) => cache.has(key))).toBe(true)
      expect(recordedKeys('p1')).toEqual(copied)
    })
  })
})

describe('pruneOfflineCopy', () => {
  describe('while the pinned document may still show the picture', () => {
    const removed = '/private/files/a.png'

    beforeEach(async () => {
      await saveOfflineCopy('p1')
      slides.value = slidesWith(['/files/b.png'])
    })

    it('stores a fresh document before the bytes go', async () => {
      const fresh = `${SHELL_HTML}<!-- fresh -->`
      state.shell = () => shellResponse({}, 200, fresh)
      let heldWhenDeleting = ''
      const deleteKey = cache.delete.bind(cache)
      vi.spyOn(cache, 'delete').mockImplementation(async (key: string) => {
        if (key === removed) {
          heldWhenDeleting = await cache.text('/d/n1')
        }

        return deleteKey(key)
      })

      await pruneOfflineCopy('p1')

      expect(heldWhenDeleting).toBe(fresh)
      expect(cache.has(removed)).toBe(false)
      expect(recordedKeys('p1')).not.toContain(removed)
    })

    it('keeps the bytes when a fresh document cannot be fetched', async () => {
      state.shell = () => shellResponse({}, 503)

      await pruneOfflineCopy('p1').catch(() => {})

      expect(cache.has(removed)).toBe(true)
      expect(recordedKeys('p1')).toContain(removed)
    })

    it('keeps the bytes when a fresh document does not fit', async () => {
      const fresh = `${SHELL_HTML}<!-- fresh -->`
      state.shell = () => shellResponse({}, 200, fresh)
      vi.spyOn(cache, 'put').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))

      await pruneOfflineCopy('p1').catch(() => {})

      expect(cache.has(removed)).toBe(true)
      expect(recordedKeys('p1')).toContain(removed)
    })
  })

  it('asks the server for nothing when no bytes are due to go', async () => {
    await saveOfflineCopy('p1')
    startupFetched.length = 0

    await pruneOfflineCopy('p1')

    expect(startupFetched).toEqual([])
  })

  describe('alongside a run that started first', () => {
    const removed = '/private/files/a.png'

    function holdsTheShell() {
      const { promise: answered, resolve } = Promise.withResolvers<void>()
      const next = fetch
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url === '/d/n1') {
          await answered
        }

        return next(url, init)
      })

      return resolve
    }

    it('does not have its removal undone by a visit', async () => {
      presentationId.value = 'v1'
      await saveOfflineCopy('v1')
      slides.value = slidesWith(['/files/b.png'])
      const answer = holdsTheShell()

      const visiting = warmOfflineCopyAssets('v1')
      await new Promise((resolve) => setTimeout(resolve, 0))
      const pruning = pruneOfflineCopy('v1')
      await new Promise((resolve) => setTimeout(resolve, 0))
      answer()
      await Promise.all([visiting, pruning])

      expect(cache.has(removed)).toBe(false)
      expect(recordedKeys('v1')).not.toContain(removed)

      slides.value = slidesWith(['/files/a.png'], ['/files/b.png'])
      refreshOfflineStatus('v1')

      expect(offlineCopyStatus.value).toBe('outdated')
    })

    it('does not have its removal undone by a save storing a new picture', async () => {
      await saveOfflineCopy('p1')
      slides.value = slidesWith(['/files/b.png'], ['/files/c.png'])
      const { promise: answered, resolve: answer } = Promise.withResolvers<void>()
      const next = fetch
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url.includes('c.png')) {
          await answered
        }

        return next(url, init)
      })
      responses['/private/files/c.png?slides_media=1'] = () => image(30)

      const saving = saveOfflineCopy('p1')
      await new Promise((resolve) => setTimeout(resolve, 0))
      const pruning = pruneOfflineCopy('p1')
      await new Promise((resolve) => setTimeout(resolve, 0))
      answer()
      await Promise.all([saving, pruning])

      expect(cache.has(removed)).toBe(false)
      expect(recordedKeys('p1')).toEqual(['/private/files/b.png', '/private/files/c.png'])
    })
  })

  it('keeps in the record what a save pins while the bytes are being deleted', async () => {
    await saveOfflineCopy('p1')
    slides.value = slidesWith(['/files/b.png'])
    responses['/private/files/c.png?slides_media=1'] = () => image(30)
    const deleteKey = cache.delete.bind(cache)
    let saving: Promise<unknown> | undefined
    vi.spyOn(cache, 'delete').mockImplementationOnce(async (key: string) => {
      slides.value = slidesWith(['/files/b.png'], ['/files/c.png'])
      saving = saveOfflineCopy('p1')
      await new Promise((resolve) => setTimeout(resolve, 0))

      return deleteKey(key)
    })

    await pruneOfflineCopy('p1')
    await saving

    expect(cache.has('/private/files/c.png')).toBe(true)
    expect(recordedKeys('p1')).toEqual(['/private/files/b.png', '/private/files/c.png'])
  })

  it('drops the bytes of an image the presentation no longer shows', async () => {
    await saveOfflineCopy('p1')
    slides.value = slidesWith(['/files/b.png'])

    await pruneOfflineCopy('p1')

    expect(cache.has('/private/files/a.png')).toBe(false)
    expect(cache.has('/private/files/b.png')).toBe(true)
    expect(recordedKeys('p1')).toEqual(['/private/files/b.png'])
    expect(statusOf('p1')).toBe('available')
  })

  it('keeps bytes another offline copy still lists', async () => {
    await saveOfflineCopy('p1')
    await saveOfflineCopy('p2')
    slides.value = slidesWith(['/files/b.png'])

    await pruneOfflineCopy('p1')

    expect(cache.has('/private/files/a.png')).toBe(true)
    expect(recordedKeys('p2')).toEqual(['/private/files/a.png', '/private/files/b.png'])
  })

  it('leaves an unchanged copy alone, without opening the cache', async () => {
    await saveOfflineCopy('p1')
    vi.stubGlobal('caches', {
      open: async () => {
        throw new Error('should not open the cache')
      },
    })

    await pruneOfflineCopy('p1')

    expect(recordedKeys('p1')).toEqual(['/private/files/a.png', '/private/files/b.png'])
  })

  it('does nothing for a presentation with no offline copy', async () => {
    await expect(pruneOfflineCopy('p1')).resolves.toBeUndefined()
    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
  })

  describe('a picture named by its Drive node', () => {
    const picture = '/private/files/m1.png'
    const signed = `${picture}?signature=s1`
    const src = ref<string | null>(null)
    const status = ref<'loading' | 'unanswered' | 'ready' | 'refused'>('ready')
    let release: () => void

    function driveAnswers(url: string | null, answer: typeof status.value) {
      src.value = url
      status.value = answer
    }

    beforeEach(async () => {
      release = setDocumentMedia((id) => ({
        id,
        src,
        status,
        cacheKey: ref(id),
        refresh: async () => {},
      }))
      responses[signed] = () => image(30)
      driveAnswers(signed, 'ready')
      slides.value = slidesWith(['/files/a.png', 'media-node-1'])
      await saveOfflineCopy('p1')
    })

    afterEach(() => {
      release()
      vi.useRealTimers()
    })

    it.each(['loading', 'unanswered'] as const)(
      'keeps its bytes when the read is still %s after the wait',
      async (waiting) => {
        vi.useFakeTimers()
        driveAnswers(null, waiting)

        const pruning = pruneOfflineCopy('p1')
        await vi.advanceTimersByTimeAsync(30_000)
        await pruning

        expect(cache.has(picture)).toBe(true)
        expect(recordedKeys('p1')).toContain(picture)
      },
    )

    it('keeps everything while any picture waits, not only the waiting one', async () => {
      vi.useFakeTimers()
      driveAnswers(null, 'unanswered')
      slides.value = slidesWith(['media-node-1'])

      const pruning = pruneOfflineCopy('p1')
      await vi.advanceTimersByTimeAsync(30_000)
      await pruning

      expect(cache.has('/private/files/a.png')).toBe(true)
    })

    it('prunes what the presentation no longer shows once the read answers', async () => {
      driveAnswers(null, 'loading')
      slides.value = slidesWith(['media-node-1'])

      const pruning = pruneOfflineCopy('p1')
      driveAnswers(signed, 'ready')
      await pruning

      expect(cache.has(picture)).toBe(true)
      expect(cache.has('/private/files/a.png')).toBe(false)
    })

    it('leaves the copy alone when another presentation opens during the wait', async () => {
      driveAnswers(null, 'loading')

      const pruning = pruneOfflineCopy('p1')
      presentationId.value = 'p2'
      slides.value = slidesWith(['/files/b.png'])
      driveAnswers(signed, 'ready')
      await pruning

      expect(cache.has(picture)).toBe(true)
      expect(cache.has('/private/files/a.png')).toBe(true)
    })

    it('keeps its bytes on open when an expired session has it refused', async () => {
      driveAnswers(null, 'refused')

      await pruneOfflineCopy('p1')

      expect(cache.has(picture)).toBe(true)
      expect(recordedKeys('p1')).toContain(picture)
    })

    it('keeps its bytes on save when an expired session has it refused', async () => {
      driveAnswers(null, 'refused')

      await saveOfflineCopy('p1')

      expect(cache.has(picture)).toBe(true)
      expect(recordedKeys('p1')).toContain(picture)
    })

    it('keeps its bytes and its place in the record when a save outwaits the read', async () => {
      vi.useFakeTimers()
      driveAnswers(null, 'unanswered')

      const saving = saveOfflineCopy('p1')
      await vi.advanceTimersByTimeAsync(30_000)
      const result = await saving

      expect(result?.failed).toEqual([{ slideIndex: 0, src: 'media-node-1', status: 'timeout' }])
      expect(cache.has(picture)).toBe(true)
      expect(recordedKeys('p1')).toContain(picture)
    })
  })
})

describe('a pin and the visited copies', () => {
  function visitedEntry(node: string) {
    return new Response('old', { headers: { 'x-visited-node': node } })
  }

  async function seedVisited() {
    state.visitedCache = new FakeCache()
    // what the store reads back: a clone for each match, a path for each key
    state.visitedCache.keys = async () =>
      [...state.visitedCache!.store.keys()].map((url) => ({ url }))
    Object.assign(state.visitedCache, {
      match: async (key: string) =>
        state.visitedCache!.store.get(new URL(key, 'http://localhost').href)?.clone(),
    })
    await state.visitedCache.put('/d/n1', visitedEntry('n1'))
    await state.visitedCache.put('/api/suite/drive/nodes/n1/media', visitedEntry('n1'))
    await state.visitedCache.put('/d/n2', visitedEntry('n2'))
    return state.visitedCache
  }

  it('Save copy drops the visited copy of that node only', async () => {
    const seeded = await seedVisited()

    await saveOfflineCopy('p1')

    expect(seeded.has('/d/n1')).toBe(false)
    expect(seeded.has('/api/suite/drive/nodes/n1/media')).toBe(false)
    expect(seeded.has('/d/n2')).toBe(true)
  })

  it.each(['QuotaExceededError', 'InvalidAccessError', 'DataError', 'UnknownError'])(
    'a pin refused with %s clears the visited copies and retries',
    async (name) => {
      await seedVisited()
      const put = cache.put.bind(cache)
      let failures = 0
      cache.put = async (key, response) => {
        if (key.startsWith('/private/files/') && failures++ === 0) {
          throw new DOMException('full', name)
        }

        return put(key, response)
      }

      const result = await saveOfflineCopy('p1')

      expect(deletedCaches).toEqual(['slides-visited'])
      expect(result).toEqual({ ok: true, failed: [], count: 2 })
    },
  )

  it.each(['AbortError', 'NetworkError'])(
    'a pin whose body fails with %s clears nothing',
    async (name) => {
      await seedVisited()
      const put = cache.put.bind(cache)
      cache.put = async (key, response) => {
        if (key.startsWith('/private/files/')) {
          throw new DOMException('aborted', name)
        }

        return put(key, response)
      }

      await saveOfflineCopy('p1')

      expect(deletedCaches).toEqual([])
    },
  )

  it('start-up at the quota clears the visited copies and retries', async () => {
    const put = cache.put.bind(cache)
    let failures = 0
    cache.put = async (key, response) => {
      if (key === '/d/n1' && failures++ === 0) {
        throw new DOMException('full', 'QuotaExceededError')
      }

      return put(key, response)
    }

    const result = await saveOfflineCopy('p1')

    expect(deletedCaches).toEqual(['slides-visited'])
    expect(result?.ok).toBe(true)
    expect(cache.has('/d/n1')).toBe(true)
  })

  it('a refused node loses its pin and its visited copy', async () => {
    await saveOfflineCopy('p1')
    const seeded = await seedVisited()

    await removeNodeOfflineCopy('n1')

    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
    expect(cache.has('/d/n1')).toBe(false)
    expect(seeded.has('/d/n1')).toBe(false)
    expect(seeded.has('/d/n2')).toBe(true)
  })

  it('a refused node with no pin still loses its visited copy', async () => {
    const seeded = await seedVisited()

    await removeNodeOfflineCopy('n1')

    expect(seeded.has('/d/n1')).toBe(false)
  })

  it('stores every font the slides declare before it reports the pin saved', async () => {
    const result = await saveOfflineCopy('p1')

    expect(result?.ok).toBe(true)
    expect(DECLARED_FONTS.length).toBeGreaterThan(0)
    expect(DECLARED_FONTS.filter((url) => !cache.has(url))).toEqual([])
    expect(DECLARED_FONTS.filter((url) => !recordOf('p1').keys.includes(url))).toEqual([])
  })

  it('fails a pin whose font could not be stored', async () => {
    const original = fetch
    const font = '/assets/suite/slides/fonts/Anton/Anton-Regular-latin.woff2'
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
      url === font ? new Response('', { status: 503 }) : original(url, init),
    )

    await expect(saveOfflineCopy('p1')).rejects.toThrow(font)
    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
  })

  it('marks what a pin fetches, so the worker stays out of it', async () => {
    const original = fetch
    const unmarked: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const isStartup =
        url.startsWith('/d/') || url.startsWith('/api/') || url.startsWith('/assets/')
      if (isStartup && !new Headers(init?.headers).has('x-slides-pin')) {
        unmarked.push(url)
      }

      return original(url, init)
    })

    await saveOfflineCopy('p1')

    expect(startupFetched.length).toBeGreaterThan(0)
    expect(unmarked).toEqual([])
  })
})

describe('removeOfflineCopy', () => {
  it('deletes only keys no other offline copy uses', async () => {
    await saveOfflineCopy('p1')
    slides.value = slidesWith(['/files/b.png', '/files/c.png'])
    responses['/private/files/c.png?slides_media=1'] = () => image()
    await saveOfflineCopy('p2')

    await removeOfflineCopy('p1')

    expect(cache.has('/private/files/a.png')).toBe(false)
    expect(cache.has('/private/files/b.png')).toBe(true)
    expect(cache.has('/private/files/c.png')).toBe(true)
    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
    presentationId.value = 'p2'
    expect(statusOf('p2')).toBe('available')
  })
})

// Q18′: a copy saved before the presentation went live holds its rows, which offline would open in place of the room
describe('a copy saved before the presentation went live', () => {
  const rowed = () =>
    new Response(JSON.stringify({ message: { name: 'p1', slides: [{ name: 's1' }] } }), {
      headers: { 'Content-Type': 'application/json' },
    })
  const [presentationRead] = STARTUP_API

  async function savedBeforeLive() {
    await saveOfflineCopy('p1')
    await cache.put(presentationRead, rowed())
  }

  it("loses its rows to the owner's refresh", async () => {
    await savedBeforeLive()

    await warmOfflineCopyAssets('p1')

    expect(await cache.text(presentationRead)).not.toContain('slides')
  })

  it('is removed with its files for someone who cannot refresh it', async () => {
    await savedBeforeLive()

    await removeRowedOfflineCopy('p1')

    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
    expect(cache.has(presentationRead)).toBe(false)
    expect(cache.has('/private/files/a.png')).toBe(false)
  })

  it('is kept when it holds no rows', async () => {
    await saveOfflineCopy('p1')

    await removeRowedOfflineCopy('p1')

    expect(recordedKeys('p1')).toEqual(['/private/files/a.png', '/private/files/b.png'])
    expect(cache.has(presentationRead)).toBe(true)
  })
})
