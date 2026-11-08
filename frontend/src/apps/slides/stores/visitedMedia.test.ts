import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const slides = ref<unknown[]>([])
const presentationDoc = ref<Record<string, unknown>>({})
const presentationId = ref('p1')
const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const state = vi.hoisted(() => ({ user: fromPartial<string | null>('me@example.com') }))

vi.mock('@/apps/slides/stores/presentation', () => ({ presentationDoc, presentationId }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides, currentSlide: ref(null) }))
vi.mock('@/apps/slides/stores/element', () => ({
  addMediaElement: vi.fn(),
  replaceMediaElement: vi.fn(),
}))
vi.mock('frappe-ui', () => ({ toast: {}, FileUploadHandler: class {} }))
vi.mock('@/apps/slides/pages/Slideshow.vue', () => ({ default: {} }))
vi.mock('@/apps/slides/utils/bundledFonts', () => ({ loadBundledFonts: async () => {} }))
vi.mock('@/platform/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/session')>()
  return {
    ...original,
    getCookieSessionUser: () => state.user,
    useSession: () => ({
      ...original.useSession(),
      user: {
        get value() {
          if (!state.user) {
            return null
          }

          return { id: state.user }
        },
      },
    }),
  }
})
vi.mock('@/apps/slides/utils/startupRequests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/slides/utils/startupRequests')>()),
  delay: async () => {},
}))

const { stopVisitedMedia, storeVisitedMedia } = await import('./visitedMedia')
const { setDocumentMedia } = await import('./documentMedia')
const { draftsDbName } = await import('@/apps/slides/utils/slidesCaches')
const { openDraftsDb } = await import('@/apps/slides/utils/drafts')

const ME = 'me@example.com'
const OWNED_URL = '/private/files/a.png?slides_media=1'

class FakeCache {
  store = new Map<string, Response>()
  failure: Error | null = null
  async match(key: string) {
    return this.store.get(key)?.clone()
  }
  async put(key: string, response: Response) {
    if (this.failure) {
      throw this.failure
    }

    this.store.set(key, response)
  }
}

const named = new Map<string, FakeCache>()
let fetched: string[]
let answer: (url: string) => Response
let headersSeen: Headers[]

function openNamed(name: string) {
  const cache = named.get(name) ?? new FakeCache()
  named.set(name, cache)
  return cache
}

function media() {
  return openNamed('slides-media')
}

function png() {
  return new Response('picture', { status: 200, headers: { 'Content-Type': 'image/png' } })
}

function show(...srcs: string[]) {
  slides.value = [{ elements: srcs.map((src) => ({ type: 'image', src })) }]
}

beforeEach(() => {
  named.clear()
  fetched = []
  headersSeen = []
  answer = png
  state.user = ME
  localStorage.clear()
  localStorage.setItem('slides-caches-user', ME)
  presentationId.value = 'p1'
  presentationDoc.value = { node: 'n1', is_composite: 0, owner: ME }
  vi.stubEnv('VITE_SLIDES_SW', '1')
  vi.stubGlobal('requestIdleCallback', (run: () => void) => run())
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: null },
  })
  vi.stubGlobal('caches', {
    open: async (name: string) => openNamed(name),
    has: async (name: string) => named.has(name),
    delete: async (name: string) => named.delete(name),
  })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    fetched.push(url)
    headersSeen.push(new Headers(init?.headers))
    return answer(url)
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  stopVisitedMedia()
  delete window.disable_slides_service_worker
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('pictures of a presentation opened online', () => {
  it('stores one with no worker controlling the page, past the worker, stamped for the sweep', async () => {
    show('/private/files/a.png')

    await storeVisitedMedia('p1')

    expect(navigator.serviceWorker.controller).toBeNull()
    expect(headersSeen[0].has('x-slides-pin')).toBe(true)
    const stored = media().store.get(OWNED_URL)
    expect(await stored?.text()).toBe('picture')
    expect(Number(stored?.headers.get('x-cached-time'))).toBeGreaterThan(0)
  })

  it('keys an owner picture by the url the page asks for', async () => {
    show('/files/a.png')

    await storeVisitedMedia('p1')

    expect([...media().store.keys()]).toEqual([OWNED_URL])
    expect(fetched).toEqual([OWNED_URL])
  })

  it('keys a viewer picture by the proxy url the page asks for', async () => {
    presentationDoc.value = { node: 'n1', is_composite: 0, owner: 'someone@example.com' }
    show('/private/files/a b.png')

    await storeVisitedMedia('p1')

    const proxied =
      '/api/method/suite.slides.api.file.get_media_file?src=%2Fprivate%2Ffiles%2Fa%20b.png&presentation=p1'
    expect([...media().store.keys()]).toEqual([proxied])
  })

  it('keys a node-id picture by its file path, so a new signature still finds it', async () => {
    const src = ref('/private/files/blob1/logo.png?e=1&s=first')
    const handle = {
      id: 'node1234',
      src,
      cacheKey: ref('drive-media:node1234'),
      status: ref('ready'),
      refresh: async () => {},
    }
    const release = setDocumentMedia(() => fromPartial(handle))
    show('node1234')

    await storeVisitedMedia('p1')
    src.value = '/private/files/blob1/logo.png?e=2&s=second'
    await storeVisitedMedia('p1')

    release()
    expect(fetched.filter((url) => url.startsWith('/private/'))).toEqual([
      '/private/files/blob1/logo.png?e=1&s=first',
    ])
    expect([...media().store.keys()]).toEqual(['/private/files/blob1/logo.png'])
  })

  it('leaves alone what needs no store or could not take the header', async () => {
    show(
      'data:image/png;base64,iVBORw0KGgo=',
      '/assets/suite/slides/logo.svg',
      'https://cdn.example.com/a.png',
    )

    await storeVisitedMedia('p1')

    expect(fetched).toEqual([])
  })

  it('fetches nothing already stored', async () => {
    media().store.set(OWNED_URL, png())
    show('/private/files/a.png')

    await storeVisitedMedia('p1')

    expect(fetched).toEqual([])
  })

  it('never stores a login page as a picture', async () => {
    answer = () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
    show('/private/files/a.png')

    await storeVisitedMedia('p1')

    expect(media().store.size).toBe(0)
  })

  it('tries a url once however often the slides change, and again on the next open', async () => {
    answer = () => {
      throw new TypeError('Failed to fetch')
    }

    show('/private/files/a.png')

    await storeVisitedMedia('p1')
    await storeVisitedMedia('p1')
    expect(fetched).toEqual([OWNED_URL])

    stopVisitedMedia()
    await storeVisitedMedia('p1')
    expect(fetched).toEqual([OWNED_URL, OWNED_URL])
  })

  it('picks up a picture added by a later edit', async () => {
    show('/private/files/a.png')
    await storeVisitedMedia('p1')

    show('/private/files/a.png', '/private/files/b.png')
    await storeVisitedMedia('p1')

    expect(fetched).toEqual([OWNED_URL, '/private/files/b.png?slides_media=1'])
  })

  it('wipes the last user first, so their picture is neither kept nor taken for stored', async () => {
    localStorage.setItem('slides-caches-user', 'other@example.com')
    vi.stubGlobal('caches', {
      open: async (name: string) => openNamed(name),
      delete: async (name: string) => {
        await new Promise((resolve) => setTimeout(resolve))
        return named.delete(name)
      },
    })
    media().store.set(
      OWNED_URL,
      new Response('theirs', { headers: { 'Content-Type': 'image/png' } }),
    )
    show('/private/files/a.png')

    await storeVisitedMedia('p1')

    expect(await media().store.get(OWNED_URL)?.text()).toBe('picture')
  })

  it('wipes the last user once, however many slide changes wait on it', async () => {
    localStorage.setItem('slides-caches-user', 'other@example.com')
    const wipe = vi.spyOn(globalThis.caches, 'delete')
    show('/private/files/a.png')

    await Promise.all([storeVisitedMedia('p1'), storeVisitedMedia('p1')])

    expect(wipe.mock.calls.filter(([name]) => name === 'slides-media')).toHaveLength(1)
    expect(await media().store.get(OWNED_URL)?.text()).toBe('picture')
  })

  it.each([
    [
      'logged out',
      () => {
        state.user = null
      },
    ],
    [
      'offline',
      () => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }),
    ],
    [
      'with the kill switch on',
      () => {
        window.disable_slides_service_worker = true
      },
    ],
  ])('does nothing %s', async (_name, arrange) => {
    show('/private/files/a.png')
    arrange()

    await storeVisitedMedia('p1')

    expect(fetched).toEqual([])
    expect(named.has('slides-media')).toBe(false)
  })
})

describe('a pinned presentation', () => {
  beforeEach(() => {
    localStorage.setItem('slides-offline-copy:p1', '{"keys":[]}')
  })

  it('stores a picture it shows, in the shared cache alone', async () => {
    show('/private/files/a.png')

    await storeVisitedMedia('p1')

    expect([...named.keys()]).toEqual(['slides-media'])
    expect(await media().store.get(OWNED_URL)?.text()).toBe('picture')
    expect(localStorage.getItem('slides-offline-copy:p1')).toBe('{"keys":[]}')
  })

  it('asks for no visited list', async () => {
    show('node1234')

    await storeVisitedMedia('p1')

    expect(fetched.filter((url) => url.startsWith('/api/'))).toEqual([])
    expect(named.has('slides-visited')).toBe(false)
  })
})

describe('a full disk', () => {
  const DRAFTS = draftsDbName(ME)

  async function putDraft() {
    const db = await openDraftsDb(DRAFTS)
    const tx = db.transaction('presentations', 'readwrite')
    tx.objectStore('presentations').put({ id: 'p1', dirty: true })
    await new Promise((resolve) => {
      tx.oncomplete = resolve
    })
    db.close()
  }

  async function draft() {
    const db = await openDraftsDb(DRAFTS)
    const request = db.transaction('presentations').objectStore('presentations').get('p1')
    const record = await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result)
    })
    db.close()
    return record
  }

  it('stops storing and leaves the visited copy and the drafts alone', async () => {
    const copy = new Response('copy', { headers: { 'x-visited-node': 'n1' } })
    openNamed('slides-visited').store.set('/d/n1', copy)
    await putDraft()
    media().failure = new DOMException('full', 'QuotaExceededError')
    const pictures = Array.from({ length: 20 }, (_, index) => `/private/files/${index}.png`)
    show(...pictures)

    await storeVisitedMedia('p1')
    const fetchesAtStop = fetched.length
    await storeVisitedMedia('p1')

    expect(fetchesAtStop).toBeLessThan(pictures.length)
    expect(fetched).toHaveLength(fetchesAtStop)
    expect(media().store.size).toBe(0)
    expect(openNamed('slides-visited').store.get('/d/n1')).toBe(copy)
    expect(await draft()).toMatchObject({ id: 'p1', dirty: true })
    expect(console.warn).toHaveBeenCalled()
  })

  it('skips one picture that fails some other way and stores the rest', async () => {
    answer = (url) => {
      if (url.includes('bad')) {
        throw new TypeError('Failed to fetch')
      }

      return png()
    }

    show('/private/files/bad.png', '/private/files/good.png')

    await storeVisitedMedia('p1')

    expect([...media().store.keys()]).toEqual(['/private/files/good.png?slides_media=1'])
  })
})
