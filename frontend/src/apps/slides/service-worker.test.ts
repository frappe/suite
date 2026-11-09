import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  API_CACHE_NAME,
  MEDIA_CACHE_NAME,
  PINNED_CACHE_NAME,
  VISITED_CACHE_NAME,
} from './utils/slidesCaches'
import { warmAssets } from './utils/startupRequests'

vi.mock('@/apps/slides/pages/Slideshow.vue', () => ({}))
vi.mock('@/apps/slides/utils/bundledFonts', () => ({ loadBundledFonts: async () => {} }))

vi.mock('workbox-range-requests', () => ({
  createPartialResponse: async (_request: Request, response: Response) => response,
}))

const listeners = new Map<string, (event: any) => void>()
const pinned = new Map<string, Response>()
const visited = new Map<string, Response>()
const storedMedia = new Map<string, Response>()
const opened = new Map<string, Map<string, Response>>()
let respond: (url: string) => Promise<Response>
let online: boolean
let networkFails: boolean
let fetches: string[]

const body = (label: string) =>
  new Response(label, { status: 200, headers: { 'Content-Type': 'image/png' } })

vi.spyOn(self, 'addEventListener').mockImplementation((type: string, listener: any) => {
  listeners.set(type, listener)
})

await import('./service-worker')

const MEDIA_URL = `${location.origin}/private/files/a.png?slides_media=1`
const PINNED_KEY = '/private/files/a.png'

beforeEach(() => {
  pinned.clear()
  visited.clear()
  storedMedia.clear()
  opened.clear()
  fetches = []
  online = true
  networkFails = false
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
  vi.stubGlobal('caches', {
    match: async (key: string, { cacheName }: { cacheName: string }) => {
      if (cacheName === PINNED_CACHE_NAME) {
        return pinned.get(key)
      }

      if (cacheName === VISITED_CACHE_NAME) {
        return visited.get(key)
      }

      if (cacheName === MEDIA_CACHE_NAME) {
        return storedMedia.get(key)
      }
    },
    open: async (name: string) => {
      const entries = opened.get(name) ?? new Map<string, Response>()
      opened.set(name, entries)
      return {
        match: async (request: Request) => entries.get(request.url),
        put: async (request: Request | string, response: Response) =>
          entries.set(
            new URL(fromPartial<Request>(request).url ?? request, location.origin).href,
            response,
          ),
        keys: async () => [],
        delete: async () => true,
      }
    },
  })
  vi.stubGlobal('fetch', async (request: Request) => {
    fetches.push(request.url)
    if (networkFails) throw new TypeError('Failed to fetch')

    return new Response('network', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  })

  respond = (url) => {
    let responded: any = null
    listeners.get('fetch')!({
      request: new Request(url),
      clientId: 'c1',
      respondWith: (value: Promise<Response>) => {
        responded = value
      },
      waitUntil: () => {},
    })
    return responded
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pinned media', () => {
  it('serves the pinned copy online without touching the network', async () => {
    pinned.set(PINNED_KEY, body('pinned'))

    const response = await respond(MEDIA_URL)

    expect(await response.text()).toBe('pinned')
    expect(fetches).toEqual([])
  })

  it('serves the pinned copy offline without waiting on the network', async () => {
    pinned.set(PINNED_KEY, body('pinned'))
    online = false

    const response = await respond(MEDIA_URL)

    expect(await response.text()).toBe('pinned')
    expect(fetches).toEqual([])
  })

  it('surfaces the network error when nothing is pinned', async () => {
    networkFails = true

    await expect(respond(MEDIA_URL)).rejects.toThrow()
  })
})

// The shell document is the whole suite's. A stored copy would keep serving old
// code after a flip or a deploy (unified frontend spec §14.9).
describe('a signed picture the page stored', () => {
  const SIGNED = `${location.origin}/private/files/blob1/logo.png?e=2&s=second`

  beforeEach(() => {
    storedMedia.set('/private/files/blob1/logo.png', body('stored'))
  })

  it('answers offline under a signature it was not stored with', async () => {
    online = false

    const response = await respond(SIGNED)

    expect(await response.text()).toBe('stored')
  })

  it('stays out of the way online', () => {
    expect(respond(SIGNED)).toBeNull()
  })

  it('fails offline when nothing was stored', async () => {
    online = false
    storedMedia.clear()
    networkFails = true

    await expect(respond(SIGNED)).rejects.toThrow('Failed to fetch')
  })
})

describe('the shell document', () => {
  const dispatch = (request: Pick<Request, 'url' | 'method' | 'mode' | 'headers' | 'referrer'>) => {
    let answered = false
    listeners.get('fetch')!({
      request,
      clientId: 'c1',
      respondWith: () => {
        answered = true
      },
      waitUntil: () => {},
    })
    return answered
  }

  it('leaves a slides navigation and a shell pin to the network', () => {
    const url = `${location.origin}/slides/presentation/p1`
    const navigation = {
      url,
      method: 'GET',
      mode: 'navigate' as const,
      headers: new Headers(),
      referrer: '',
    }
    const pin = {
      ...navigation,
      mode: 'cors' as const,
      headers: new Headers({ 'x-slides-pin': 'shell' }),
    }

    expect(dispatch(navigation)).toBe(false)
    expect(dispatch(pin)).toBe(false)
  })

  it('drops the shell copy an older worker stored when it activates', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      open: async () => ({
        keys: async () => [],
        match: async () => undefined,
        delete: async () => true,
      }),
      delete: async (name: string) => deleted.push(name) > 0,
    })
    vi.stubGlobal('clients', { claim: async () => {}, matchAll: async () => [] })
    let activation: Promise<unknown> = Promise.resolve()

    listeners.get('activate')!({ waitUntil: (work: Promise<unknown>) => (activation = work) })
    await activation

    expect(deleted).toEqual(['slides-shell'])
  })
})

// offline, any same-origin GET the user pinned is answered from the pin, so a
// pinned presentation opens at /d/<node> without the network
describe('a pinned presentation offline', () => {
  type FakeRequest = Pick<Request, 'url' | 'method' | 'mode' | 'headers' | 'referrer'>

  function dispatch(request: FakeRequest, clientId = 'c1') {
    let responded: Promise<Response> | null = null
    listeners.get('fetch')!({
      request,
      clientId,
      respondWith: (value: Promise<Response>) => {
        responded = value
      },
      waitUntil: () => {},
    })
    return fromPartial<Promise<Response> | null>(responded)
  }

  function navigation(path: string): FakeRequest {
    return {
      url: `${location.origin}${path}`,
      method: 'GET',
      mode: 'navigate',
      headers: new Headers(),
      referrer: '',
    }
  }

  function get(path: string, referrer = `${location.origin}/d/n1/deck`): FakeRequest {
    return {
      url: `${location.origin}${path}`,
      method: 'GET',
      mode: 'cors',
      headers: new Headers(),
      referrer,
    }
  }

  function text(label: string, type = 'text/html') {
    return new Response(label, { status: 200, headers: { 'Content-Type': type } })
  }

  function enter(clientId: string) {
    listeners.get('message')!({
      data: 'slides-entered',
      source: { id: clientId },
      ports: [],
      waitUntil: () => {},
    })
  }

  const API = '/api/suite/drive/nodes/n1?expand=access%2Cpreview%2Cbreadcrumbs'
  const ASSET = '/assets/suite/frontend/assets/SlidesSurface-abc123.js'

  beforeEach(() => {
    online = false
    networkFails = true
    vi.stubGlobal('clients', { claim: async () => {}, matchAll: async () => [] })
    pinned.set('/d/n1', text('shell'))
    pinned.set(API, text('{}', 'application/json'))
    pinned.set(ASSET, text('chunk', 'text/javascript'))
    pinned.set(PINNED_KEY, body('picture'))
  })

  it.each(['/d/n1', '/d/n1/quarterly-plan', '/d/n1/present'])(
    'opens %s from the pinned shell',
    async (path) => {
      const response = await dispatch(navigation(path))

      expect(await response!.text()).toBe('shell')
    },
  )

  it('fails like the network for a node with nothing stored, a Writer one included', async () => {
    await expect(dispatch(navigation('/d/n2/notes'))).rejects.toThrow()
    expect(fetches).toEqual([`${location.origin}/d/n2/notes`])
  })

  it.each([
    ['a tab that never said it is slides', undefined],
    ['a tab that did', 'c2'],
  ])('serves the pinned start-up requests to %s', async (_label, entered) => {
    if (entered) {
      enter(entered)
    }

    const clientId = entered ?? 'c3'

    expect(await (await dispatch(get(API), clientId))!.text()).toBe('{}')
    expect(await (await dispatch(get(ASSET), clientId))!.text()).toBe('chunk')
    expect(
      await (await dispatch(get(MEDIA_URL.slice(location.origin.length)), clientId))!.text(),
    ).toBe('picture')
    expect(fetches).toEqual([])
  })

  it('never answers the reachability check a load relies on', async () => {
    enter('c1')

    await expect(dispatch(get('/api/method/ping'))).rejects.toThrow()
    expect(fetches).toEqual([`${location.origin}/api/method/ping`])

    online = true
    expect(dispatch(get('/api/method/ping'))).toBeNull()
  })

  it('still serves the pin once the browser restarts the worker', async () => {
    enter('c1')
    vi.resetModules()
    await import('./service-worker')

    const response = await dispatch(get(ASSET))

    expect(await response!.text()).toBe('chunk')
  })

  it('finds a picture whose signed url has expired', async () => {
    const signed = '/private/files/a.png?e=1700000000&s=abc'

    const response = await dispatch(get(signed, ''))

    expect(await response!.text()).toBe('picture')
  })

  it('leaves the pin alone online, apart from typed pinned media', async () => {
    online = true
    networkFails = false
    enter('c1')

    expect(dispatch(navigation('/d/n1/quarterly-plan'))).toBeNull()
    expect(await (await dispatch(get(ASSET)))!.text()).toBe('network')
    expect(await (await dispatch(get(MEDIA_URL.slice(location.origin.length))))!.text()).toBe(
      'picture',
    )
    expect(dispatch(get(API))).toBeNull()
  })
})

// DESIGN-slides-visited-offline §7: read offline only, after the pins
describe('a presentation opened online, offline', () => {
  type FakeRequest = Pick<Request, 'url' | 'method' | 'mode' | 'headers' | 'referrer'>

  function dispatch(request: FakeRequest, clientId = 'never-posted') {
    let responded: Promise<Response> | null = null
    listeners.get('fetch')!({
      request,
      clientId,
      respondWith: (value: Promise<Response>) => {
        responded = value
      },
      waitUntil: () => {},
    })
    return fromPartial<Promise<Response> | null>(responded)
  }

  function fakeRequest(path: string, mode: RequestMode, headers = new Headers()): FakeRequest {
    return { url: `${location.origin}${path}`, method: 'GET', mode, headers, referrer: '' }
  }

  function navigation(path: string) {
    return fakeRequest(path, 'navigate')
  }

  function get(path: string) {
    return fakeRequest(path, 'cors')
  }

  function pinGet(path: string) {
    return fakeRequest(path, 'cors', new Headers({ 'x-slides-pin': '1' }))
  }

  function text(label: string, type = 'text/html') {
    return new Response(label, { status: 200, headers: { 'Content-Type': type } })
  }

  const SHELL = '/slides-visited-shell'
  const API = '/api/suite/drive/nodes/n1?expand=access%2Cpreview%2Cbreadcrumbs'
  const SLIDES_API =
    '/api/method/suite.slides.doctype.presentation.presentation.get_public_presentation?name=p1'
  const ASSET = '/assets/suite/frontend/assets/SlidesSurface-abc123.js'

  beforeEach(() => {
    online = false
    networkFails = true
    vi.stubGlobal('clients', { claim: async () => {}, matchAll: async () => [] })
    visited.set(SHELL, text('shared shell'))
    visited.set('/d/n1', new Response(null, { status: 200 }))
    visited.set(
      API,
      new Response('{"visited":1}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'x-visited-node': 'n1' },
      }),
    )
    visited.set(ASSET, text('chunk', 'text/javascript'))
  })

  it.each(['/d/n1', '/d/n1/quarterly-plan', '/d/n1/present'])(
    'opens %s from the shared shell',
    async (path) => {
      const response = await dispatch(navigation(path))

      expect(await response!.text()).toBe('shared shell')
      expect(fetches).toEqual([])
    },
  )

  it('fails like the network for a node with no marker while others have one', async () => {
    await expect(dispatch(navigation('/d/n2/notes'))).rejects.toThrow()
    expect(fetches).toEqual([`${location.origin}/d/n2/notes`])
  })

  it('fails like the network when the marker has lost its shell', async () => {
    visited.delete(SHELL)

    await expect(dispatch(navigation('/d/n1/quarterly-plan'))).rejects.toThrow()
    expect(fetches).toEqual([`${location.origin}/d/n1/quarterly-plan`])
  })

  it('lets a pin win over a marker', async () => {
    pinned.set('/d/n1', text('pinned shell'))
    pinned.set(API, text('{"pinned":1}', 'application/json'))

    expect(await (await dispatch(navigation('/d/n1')))!.text()).toBe('pinned shell')
    expect(await (await dispatch(get(API)))!.text()).toBe('{"pinned":1}')
  })

  it('answers the data and file GETs of a tab that never posted', async () => {
    expect(await (await dispatch(get(API)))!.text()).toBe('{"visited":1}')
    expect(await (await dispatch(get(ASSET)))!.text()).toBe('chunk')
    expect(fetches).toEqual([])
  })

  it('never answers data whose node has no marker, and still answers its files', async () => {
    visited.delete('/d/n1')

    await expect(dispatch(get(API))).rejects.toThrow()
    expect(fetches).toEqual([`${location.origin}${API}`])
    expect(await (await dispatch(get(ASSET)))!.text()).toBe('chunk')
  })

  it('still answers once the browser restarts the worker', async () => {
    vi.resetModules()
    await import('./service-worker')

    expect(await (await dispatch(navigation('/d/n1')))!.text()).toBe('shared shell')
    expect(await (await dispatch(get(API)))!.text()).toBe('{"visited":1}')
  })

  it('never answers a plain GET of a node with the marker or the shell', async () => {
    await expect(dispatch(get('/d/n1'))).rejects.toThrow()
    await expect(dispatch(get('/d/n1/quarterly-plan'))).rejects.toThrow()
    expect(fetches).toHaveLength(2)
  })

  describe('the templates a warm stores', () => {
    const TEMPLATES = '/api/method/suite.slides.doctype.presentation.presentation.get_templates'

    function serverAnswers(answer: () => Response) {
      const requests: { url: string; isMarked: boolean }[] = []
      vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
        requests.push({ url, isMarked: init.headers['x-slides-pin'] === '1' })
        return answer()
      })
      return requests
    }

    function goneOffline() {
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('Failed to fetch')
      })
    }

    function json(label: string, status = 200) {
      return new Response(label, { status, headers: { 'Content-Type': 'application/json' } })
    }

    it('answers an entered tab offline from what was stored', async () => {
      const requests = serverAnswers(() => json('{"message":["a layout"]}'))

      await warmAssets()

      expect(requests).toEqual([{ url: TEMPLATES, isMarked: true }])
      goneOffline()
      listeners.get('message')!({
        data: 'slides-entered',
        source: { id: 'tab' },
        ports: [],
        waitUntil: () => {},
      })
      const response = await dispatch(get(TEMPLATES), 'tab')
      expect(await response!.text()).toBe('{"message":["a layout"]}')
    })

    it.each([
      ['a refusal', () => json('{"exc_type":"PermissionError"}', 403)],
      ['an error', () => json('{"exc_type":"Oops"}', 500)],
      ['a page that is not JSON', () => text('<html>login</html>')],
    ])('stores nothing from %s', async (_name, answer) => {
      serverAnswers(answer)

      await warmAssets()

      expect(opened.get(API_CACHE_NAME)?.size).toBe(0)
    })

    it('stores nothing when the fetch fails', async () => {
      goneOffline()

      await warmAssets()

      expect(opened.get(API_CACHE_NAME)?.size).toBe(0)
    })

    it('resolves and clears nothing when the put fails', async () => {
      serverAnswers(() => json('[]'))
      const deleted: string[] = []
      vi.stubGlobal('caches', {
        open: async () => ({
          put: async () => {
            throw new DOMException('full', 'InvalidAccessError')
          },
        }),
        delete: async (name: string) => {
          deleted.push(name)
          return true
        },
      })

      await expect(warmAssets()).resolves.toBeDefined()

      expect(deleted).toEqual([])
    })

    it('resolves when the cache cannot be opened', async () => {
      serverAnswers(() => json('[]'))
      vi.stubGlobal('caches', {
        open: async () => {
          throw new DOMException('broken', 'UnknownError')
        },
      })

      await expect(warmAssets()).resolves.toBeDefined()
    })

    describe('when the network stalls', () => {
      const stored: string[] = []

      function aborted(signal: AbortSignal, stop: (reason: DOMException) => void) {
        signal.addEventListener('abort', () => stop(new DOMException('aborted', 'AbortError')))
      }

      // what a browser's cache.put does: it reads the body before the entry exists
      function serverStalls(answer: (signal: AbortSignal) => Promise<Response>) {
        vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => answer(init.signal))
        vi.stubGlobal('caches', {
          open: async () => ({
            put: async (url: string, response: Response) => {
              await response.arrayBuffer()
              stored.push(url)
            },
          }),
        })
      }

      async function expectFreedAtTheLimit() {
        let isDone = false
        const warm = (async () => {
          await warmAssets()
          isDone = true
        })()

        await vi.advanceTimersByTimeAsync(4999)
        expect(isDone).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await new Promise((resolve) => setImmediate(resolve))

        expect(isDone).toBe(true)
        await warm
        expect(stored).toEqual([])
      }

      beforeEach(async () => {
        stored.length = 0
        await import('@/apps/slides/pages/Slideshow.vue')
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('gives up on a fetch that never answers and stores nothing', async () => {
        serverStalls((signal) => new Promise((_resolve, reject) => aborted(signal, reject)))

        await expectFreedAtTheLimit()
      })

      it('gives up on a body that never ends and stores nothing', async () => {
        serverStalls(async (signal) => {
          const endless = new ReadableStream({
            start: (controller) => aborted(signal, (reason) => controller.error(reason)),
          })
          return new Response(endless, { headers: { 'Content-Type': 'application/json' } })
        })

        await expectFreedAtTheLimit()
      })
    })

    it('does not bring the cache back after a wipe during the fetch', async () => {
      serverAnswers(() => {
        opened.delete(API_CACHE_NAME)
        return json('{"message":["old user"]}')
      })

      await warmAssets()

      expect(opened.has(API_CACHE_NAME)).toBe(false)
    })
  })

  it('falls back to slides-api when the document misses the visited copy', async () => {
    const stored = text('{"api":1}', 'application/json')
    opened.set(API_CACHE_NAME, new Map([[`${location.origin}${SLIDES_API}`, stored]]))
    const page = { ...get(SLIDES_API), referrer: `${location.origin}/slides/p1` }

    const response = await dispatch(page)

    expect(await response!.text()).toBe('{"api":1}')
  })

  it('never answers from the visited copy online', async () => {
    online = true
    networkFails = false

    expect(dispatch(navigation('/d/n1/quarterly-plan'))).toBeNull()
    expect(dispatch(get(API))).toBeNull()
    expect(dispatch(get(ASSET))).toBeNull()
  })

  it('leaves every request a capture or a pin makes to the network', async () => {
    expect(dispatch(pinGet(API))).toBeNull()
    expect(dispatch(pinGet(ASSET))).toBeNull()
    expect(dispatch(pinGet('/d/n1'))).toBeNull()
  })
})

describe('what a capture or a pin leaves in the caches', () => {
  function dispatch(request: Request | Record<string, unknown>) {
    const pending: Promise<unknown>[] = []
    let responded: Promise<Response> | null = null
    listeners.get('fetch')!({
      request,
      clientId: 'c1',
      respondWith: (value: Promise<Response>) => {
        responded = value
      },
      waitUntil: (work: Promise<unknown>) => pending.push(work),
    })
    return { responded: fromPartial<Promise<Response> | null>(responded), pending }
  }

  function get(path: string, headers: Record<string, string> = {}) {
    return {
      url: `${location.origin}${path}`,
      method: 'GET',
      mode: 'cors',
      headers: new Headers(headers),
      referrer: `${location.origin}/slides/p1`,
    }
  }

  const SLIDES_API = '/api/method/suite.slides.documents.get?name=p1'
  const ASSET = '/assets/suite/frontend/assets/index-a1.js'

  beforeEach(() => {
    vi.stubGlobal('fetch', async () => {
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  async function settle({ responded, pending }: ReturnType<typeof dispatch>) {
    await responded
    await Promise.all(pending)
  }

  it('writes no slides-api for a marked GET, and still does for a plain one', async () => {
    await settle(dispatch(get(SLIDES_API, { 'x-slides-pin': '1' })))
    expect(opened.get(API_CACHE_NAME)?.size ?? 0).toBe(0)

    await settle(dispatch(get(SLIDES_API)))
    expect(opened.get(API_CACHE_NAME)?.size).toBe(1)
  })

  it('writes no slides-assets for a marked file GET', async () => {
    await settle(dispatch(get(ASSET, { 'x-slides-pin': '1' })))

    expect(opened.get('slides-assets')?.size ?? 0).toBe(0)
  })
})
