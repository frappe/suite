import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const presentationDoc = ref<any>({ is_composite: 0 })
const presentationId = ref('p1')
const viewOnly = ref(false)
const slides = ref<any[]>([])
const loadedChunks: string[] = []

vi.mock('@/apps/slides/stores/presentation', () => ({ presentationDoc, presentationId, viewOnly }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides }))
vi.mock('@/apps/slides/utils/mediaUploads', async () => {
  const { isMediaNodeId, mediaNodeUrl } = await import('@/apps/slides/stores/documentMedia')
  function getAttachmentUrl(src: string) {
    if (isMediaNodeId(src)) {
      return mediaNodeUrl(src)
    }

    return `/private${src}?slides_media=1`
  }

  return { getAttachmentUrl }
})
vi.mock('@/apps/slides/utils/loadedAssets', () => ({ loadedAssets: () => loadedChunks }))
let slideshowChunkLoads = 0
vi.mock('@/apps/slides/pages/Slideshow.vue', () => {
  slideshowChunkLoads += 1
  return { default: {} }
})

const {
  saveOfflineCopy,
  pruneOfflineCopy,
  cancelOfflineCopy,
  removeOfflineCopy,
  removeNodeOfflineCopy,
  refreshOfflineStatus,
  warmOfflineCopyAssets,
  offlineCopyProgress,
  offlineCopyStatus,
} = await import('./offlineCopy')
const { setDocumentMedia } = await import('@/apps/slides/stores/documentMedia')

const statusOf = (id: string) => {
  refreshOfflineStatus(id)
  return offlineCopyStatus.value
}

function recordOf(id: string) {
  return JSON.parse(localStorage.getItem(`slides-offline-copy:${id}`)!)
}

// the pictures the record lists; the shell, API and asset keys have tests of their own
const recordedKeys = (id: string) =>
  recordOf(id).keys.filter((key: string) => key.startsWith('/private/files/'))

class FakeCache {
  store = new Map<string, Response>()
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }))
  }
  async put(key: string, response: Response) {
    this.store.set(new URL(key, 'http://localhost').href, response)
  }
  async delete(key: string) {
    return this.store.delete(new URL(key, 'http://localhost').href)
  }
  has(key: string) {
    return this.store.has(new URL(key, 'http://localhost').href)
  }
  text(key: string) {
    return this.store.get(new URL(key, 'http://localhost').href)!.clone().text()
  }
}

let cache: FakeCache
let visitedCache: FakeCache | null
const deletedCaches: string[] = []
let responses: Record<string, () => Response | Error>
let shell: () => Response
const fetched: string[] = []
const startupFetched: string[] = []

const SHELL_HTML = `<html><head>
  <script type="module" src="/assets/suite/frontend/assets/index-a1.js"></script>
  <link rel="stylesheet" href="/assets/suite/frontend/assets/index-c3.css">
</head><body></body></html>`

function shellResponse(headers: Record<string, string> = {}, status = 200, html = SHELL_HTML) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Suite-Build': '100', ...headers },
  })
}

function json(status = 200) {
  return new Response('{"data":{}}', { status, headers: { 'Content-Type': 'application/json' } })
}

const STARTUP_API = [
  '/api/method/suite.slides.doctype.presentation.presentation.get_public_presentation?name=p1',
  '/api/suite/drive/nodes/n1?expand=access%2Cpreview%2Cbreadcrumbs',
  '/api/suite/drive/nodes/n1/media',
]
const ENTRY_ASSETS = [
  '/assets/suite/frontend/assets/index-a1.js',
  '/assets/suite/frontend/assets/index-c3.css',
]
const LAZY_CHUNK = '/assets/suite/frontend/assets/SlidesSurface-d4.js'

const image = (bytes = 10) =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes) },
  })

const slidesWith = (...srcs: string[][]) =>
  srcs.map((list) => ({ elements: list.map((src) => ({ type: 'image', src })) }))

beforeEach(() => {
  cache = new FakeCache()
  visitedCache = null
  deletedCaches.length = 0
  fetched.length = 0
  startupFetched.length = 0
  loadedChunks.splice(0, loadedChunks.length, LAZY_CHUNK)
  shell = () => shellResponse()
  vi.stubGlobal('__SUITE_BUILD__', '100')
  localStorage.clear()
  responses = {}
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      if (name !== 'slides-visited') {
        return cache
      }

      visitedCache ??= new FakeCache()
      return visitedCache
    },
    has: async (name: string) => name !== 'slides-visited' || visitedCache !== null,
    delete: async (name: string) => {
      deletedCaches.push(name)
      if (name === 'slides-visited') {
        visitedCache = null
      }

      return true
    },
  })
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    serviceWorker: { controller: {}, addEventListener: () => {} },
  })
  presentationDoc.value = { node: 'n1', is_composite: 0, modified: '2026-08-17 10:00:00' }
  presentationId.value = 'p1'
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.startsWith('/d/')) {
      startupFetched.push(url)

      return shell()
    }

    if (url.startsWith('/api/')) {
      startupFetched.push(url)

      return json()
    }

    if (url.startsWith('/assets/')) {
      startupFetched.push(url)

      return new Response('chunk', { headers: { 'Content-Type': 'text/javascript' } })
    }
    fetched.push(url)
    const make = responses[url]
    if (!make) return new Response('', { status: 404 })
    const out = make()
    if (out instanceof Error) throw out
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    return out
  })
  slides.value = slidesWith(['/files/a.png'], ['/files/b.png'])
  responses['/private/files/a.png?slides_media=1'] = () => image(10)
  responses['/private/files/b.png?slides_media=1'] = () => image(20)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('collects no picture Drive refused, and does not wait for it', async () => {
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

    expect(result).toEqual({ ok: true, failed: [], count: 1 })
    expect(recordedKeys('p1')).toEqual(['/private/files/a.png'])
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

  it('drops the bytes of images the presentation no longer shows', async () => {
    await saveOfflineCopy('p1')
    slides.value = slidesWith(['/files/b.png'])

    await saveOfflineCopy('p1')

    expect(cache.has('/private/files/a.png')).toBe(false)
    expect(recordedKeys('p1')).toEqual(['/private/files/b.png'])
  })
})

describe('pruneOfflineCopy', () => {
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
})

describe('a pin and the visited copies', () => {
  function visitedEntry(node: string) {
    return new Response('old', { headers: { 'x-visited-node': node } })
  }

  async function seedVisited() {
    visitedCache = new FakeCache()
    // what the store reads back: a clone for each match, a path for each key
    visitedCache.keys = async () => [...visitedCache!.store.keys()].map((url) => ({ url }))
    Object.assign(visitedCache, {
      match: async (key: string) =>
        visitedCache!.store.get(new URL(key, 'http://localhost').href)?.clone(),
    })
    await visitedCache.put('/d/n1', visitedEntry('n1'))
    await visitedCache.put('/api/suite/drive/nodes/n1/media', visitedEntry('n1'))
    await visitedCache.put('/d/n2', visitedEntry('n2'))
    return visitedCache
  }

  it('Save copy drops the visited copy of that node only', async () => {
    const seeded = await seedVisited()

    await saveOfflineCopy('p1')

    expect(seeded.has('/d/n1')).toBe(false)
    expect(seeded.has('/api/suite/drive/nodes/n1/media')).toBe(false)
    expect(seeded.has('/d/n2')).toBe(true)
  })

  it('a pin at the quota clears the visited copies and retries', async () => {
    await seedVisited()
    const put = cache.put.bind(cache)
    let failures = 0
    cache.put = async (key, response) => {
      if (key.startsWith('/private/files/') && failures++ === 0) {
        throw new DOMException('full', 'QuotaExceededError')
      }

      return put(key, response)
    }

    const result = await saveOfflineCopy('p1')

    expect(deletedCaches).toEqual(['slides-visited'])
    expect(result).toEqual({ ok: true, failed: [], count: 2 })
  })

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
})

// what opening the presentation at /d/<node> offline needs (DESIGN-slides-offline §3)
describe('the start-up copy', () => {
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
    shell = make

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
    shell = () => shellResponse({}, 200, SHELL_HTML.replaceAll('index-a1', 'index-e5'))
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
    shell = () =>
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
    shell = () => shellResponse({ 'X-Suite-Build': '100' }, 200, html)

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
    shell = () => shellResponse({}, 200, SHELL_HTML.replaceAll('index-a1', 'index-e5'))
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
    shell = () => shellResponse({}, 200, SHELL_HTML.replaceAll('index-a1', 'index-e5'))
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
    shell = () => shellResponse({}, 200, SHELL_HTML.replaceAll('index-a1', 'index-e5'))
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
    shell = () => shellResponse({ 'X-Suite-Build': '200' })
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

  it('refreshes nothing for a presentation with no offline copy', async () => {
    await warmOfflineCopyAssets('p1')

    expect(startupFetched).toEqual([])
    expect(cache.store.size).toBe(0)
  })
})
