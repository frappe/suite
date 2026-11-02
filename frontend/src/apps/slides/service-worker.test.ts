import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PINNED_CACHE_NAME } from './utils/slidesCaches'

vi.mock('workbox-range-requests', () => ({
  createPartialResponse: async (_request: Request, response: Response) => response,
}))

const listeners = new Map<string, (event: any) => void>()
const pinned = new Map<string, Response>()
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
  opened.clear()
  fetches = []
  online = true
  networkFails = false
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
  vi.stubGlobal('caches', {
    match: async (key: string, { cacheName }: { cacheName: string }) =>
      cacheName === PINNED_CACHE_NAME ? pinned.get(key) : undefined,
    open: async (name: string) => {
      const entries = opened.get(name) ?? new Map<string, Response>()
      opened.set(name, entries)
      return {
        match: async (request: Request) => entries.get(request.url),
        put: async (request: Request, response: Response) => entries.set(request.url, response),
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
    return responded as Promise<Response> | null
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

  it('fails like the network for a node nobody pinned, a Writer one included', async () => {
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
