import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const presentationDoc = ref<Record<string, unknown> | null>(null)
const presentationId = ref('')
const viewOnly = ref(false)
const slides = ref<unknown[]>([])
const loadedChunks: string[] = []
const state = vi.hoisted(() => ({ user: 'a@example.com' as string | null }))

vi.mock('@/apps/slides/stores/presentation', () => ({ presentationDoc, presentationId, viewOnly }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: (src: string) => src }))
vi.mock('@/apps/slides/utils/loadedAssets', () => ({ loadedAssets: () => loadedChunks }))
vi.mock('@/apps/slides/pages/Slideshow.vue', () => ({ default: {} }))
vi.mock('@/platform/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/session')>()),
  getCookieSessionUser: () => state.user,
}))

const VISITED = 'slides-visited'
const SHELL_KEY = '/slides-visited-shell'
const ENTRY = '/assets/suite/frontend/assets/index-a1.js'
const STYLE = '/assets/suite/frontend/assets/index-c3.css'
const CHUNK = '/assets/suite/frontend/assets/SlidesSurface-d4.js'
const FILES = [ENTRY, STYLE, CHUNK]

function dataUrl(node: string, id: string) {
  const [url] = dataUrls(node, id)
  return url
}

function dataUrls(node: string, id: string) {
  return [
    `/api/method/suite.slides.doctype.presentation.presentation.get_public_presentation?name=${id}`,
    `/api/suite/drive/nodes/${node}?expand=access%2Cpreview%2Cbreadcrumbs`,
    `/api/suite/drive/nodes/${node}/media`,
  ]
}

// what the Cache API does: a handle outlives a delete of its name, and match gives a fresh copy
class FakeCache {
  store = new Map<string, Response>()
  putHook: ((key: string) => void | Promise<void>) | null = null
  afterPut: ((key: string) => void) | null = null
  async keys() {
    return [...this.store.keys()].map((key) => ({ url: `${location.origin}${key}` }))
  }
  async match(key: string) {
    return this.store.get(key)?.clone()
  }
  async put(key: string, response: Response) {
    await this.putHook?.(key)
    this.store.set(key, response)
    this.afterPut?.(key)
  }
  async delete(key: string) {
    return this.store.delete(key)
  }
}

const named = new Map<string, FakeCache>()
const openedNames: string[] = []
const requests: { url: string; isMarked: boolean }[] = []
const refused = new Set<string>()
let shell: () => Response
let holdFetch: Promise<unknown> | null
let clock: number

function holdFetches() {
  let release = () => {}

  holdFetch = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => release()
}

function open(name = VISITED) {
  const cache = named.get(name) ?? new FakeCache()
  named.set(name, cache)
  return cache
}

function visited() {
  return open()
}

function keys() {
  return [...visited().store.keys()]
}

function fetchedUrls() {
  return requests.map((request) => request.url)
}

function shellFetches() {
  return fetchedUrls().filter((url) => url.startsWith('/d/'))
}

function fileFetches() {
  return fetchedUrls().filter((url) => url.startsWith('/assets/'))
}

function header(key: string, name: string) {
  return visited().store.get(key)?.headers.get(name)
}

function shellHtml(token = 'tok1') {
  return `<html><head>
    <script>window.csrf_token = '${token}'</script>
    <script type="module" src="${ENTRY}"></script>
    <link rel="stylesheet" href="${STYLE}">
  </head></html>`
}

function shellResponse(token = 'tok1', headers: Record<string, string> = {}, status = 200) {
  return new Response(shellHtml(token), {
    status,
    headers: { 'Content-Type': 'text/html', 'X-Suite-Build': '100', ...headers },
  })
}

function seedNode(node: string, time: number) {
  visited().store.set(
    `/d/${node}`,
    new Response(null, {
      headers: { 'x-visited-node': node, 'x-visited-time': String(time) },
    }),
  )
  for (const url of dataUrls(node, `id-${node}`)) {
    visited().store.set(url, new Response('old', { headers: { 'x-visited-node': node } }))
  }
}

function seedShell(build = '100', token = 'tok1') {
  visited().store.set(
    SHELL_KEY,
    new Response(shellHtml(token), {
      headers: { 'x-visited-build': build, 'x-visited-csrf': token, 'Content-Type': 'text/html' },
    }),
  )
}

function seedFile(path: string, build: string) {
  visited().store.set(path, new Response('old file', { headers: { 'x-visited-build': build } }))
}

async function loadStore() {
  vi.resetModules()
  return import('./visitedCopies')
}

function showPresentation(node = 'n1', id = 'p1', doc: Record<string, unknown> = {}) {
  presentationId.value = id
  presentationDoc.value = { node, is_composite: 0, ...doc }
}

async function visit(node = 'n1', id = 'p1') {
  const { rememberVisit } = await loadStore()
  showPresentation(node, id)
  await rememberVisit(id)
}

beforeEach(() => {
  named.clear()
  openedNames.length = 0
  requests.length = 0
  refused.clear()
  loadedChunks.splice(0, loadedChunks.length, CHUNK)
  localStorage.clear()
  state.user = 'a@example.com'
  shell = () => shellResponse()
  holdFetch = null
  clock = 1000
  window.csrf_token = 'tok1'
  delete window.disable_slides_service_worker
  vi.stubEnv('VITE_SLIDES_SW', '1')
  vi.stubGlobal('__SUITE_BUILD__', '100')
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // the wait for an idle moment has its own test
  vi.stubGlobal('requestIdleCallback', (run: () => void) => run())
  vi.stubGlobal('setTimeout', (run: () => void) => {
    queueMicrotask(run)
    return 0
  })
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    serviceWorker: { controller: {}, addEventListener: () => {} },
  })
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      openedNames.push(name)
      return open(name)
    },
    has: async (name: string) => named.has(name),
    delete: async (name: string) => named.delete(name),
  })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    // frappe-ui asks for its translations on import
    if (url.includes('get_boot_translations')) {
      return new Response('{}')
    }

    requests.push({ url, isMarked: new Headers(init?.headers).has('x-slides-pin') })
    await holdFetch
    if (init?.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError')
    }

    if (url.startsWith('/d/')) {
      return shell()
    }

    if (refused.has(url)) {
      return new Response('', { status: 403 })
    }

    if (url.startsWith('/api/')) {
      return new Response(`{"url":"${url}"}`, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('file', { status: 200, headers: { 'Content-Type': 'text/javascript' } })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('a first visit', () => {
  it('stores the shell, the files, the data and the marker', async () => {
    await visit()

    expect(keys().sort()).toEqual([SHELL_KEY, ...FILES, ...dataUrls('n1', 'p1'), '/d/n1'].sort())
    expect(header(SHELL_KEY, 'x-visited-build')).toBe('100')
    expect(header(ENTRY, 'x-visited-build')).toBe('100')
    expect(header(dataUrl('n1', 'p1'), 'x-visited-node')).toBe('n1')
    expect(header('/d/n1', 'x-visited-node')).toBe('n1')
    expect(header('/d/n1', 'x-visited-time')).toBe('1000')
  })

  it('marks every request so the worker stays out of it', async () => {
    await visit()

    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => request.isMarked)).toBe(true)
  })

  it('leaves the pins and the button alone', async () => {
    await visit()
    const { offlineCopyStatus, refreshOfflineStatus } = await import('./offlineCopy')
    refreshOfflineStatus('p1')

    expect(openedNames).not.toContain('slides-pinned')
    expect(offlineCopyStatus.value).toBe('none')
    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
  })

  it('takes the csrf label from the fetched shell, never from the page', async () => {
    shell = () => shellResponse('rotated')

    await visit()

    expect(header(SHELL_KEY, 'x-visited-csrf')).toBe('rotated')
  })
})

describe('a later visit', () => {
  it('adds only data and a marker for a second node on one build', async () => {
    await visit()
    requests.length = 0

    await visit('n2', 'p2')

    expect(fetchedUrls().sort()).toEqual(dataUrls('n2', 'p2').sort())
    expect(keys()).toContain('/d/n2')
  })

  it('refetches the data and moves the time, with no shell or file GET', async () => {
    await visit()
    requests.length = 0
    clock = 5000

    await visit()

    expect(fetchedUrls().sort()).toEqual(dataUrls('n1', 'p1').sort())
    expect(header('/d/n1', 'x-visited-time')).toBe('5000')
  })

  it('refetches the data of a node whose build was captured by another node', async () => {
    seedNode('n1', 500)
    await visit('n2', 'p2')
    requests.length = 0

    await visit('n1', 'id-n1')

    expect(shellFetches()).toEqual([])
    expect(fileFetches()).toEqual([])
    expect(fetchedUrls().sort()).toEqual(dataUrls('n1', 'id-n1').sort())
    expect(await visited().store.get(dataUrl('n1', 'id-n1'))!.clone().text()).not.toBe('old')
  })

  it('refetches the shell when the token changed', async () => {
    await visit()
    requests.length = 0
    window.csrf_token = 'tok2'
    shell = () => shellResponse('tok2')

    await visit()

    expect(shellFetches()).toEqual(['/d/n1'])
    expect(header(SHELL_KEY, 'x-visited-csrf')).toBe('tok2')
  })

  it('refills an emptied cache from the same state', async () => {
    await visit()
    named.delete(VISITED)

    await visit()

    expect(keys().sort()).toEqual([SHELL_KEY, ...FILES, ...dataUrls('n1', 'p1'), '/d/n1'].sort())
  })

  it('runs once per presentation per page', async () => {
    const { rememberVisit } = await loadStore()
    showPresentation()

    await rememberVisit('p1')
    requests.length = 0
    await rememberVisit('p1')

    expect(requests).toEqual([])
  })
})

describe('a shell it must not store', () => {
  function redirected() {
    const response = shellResponse('tok2')
    Object.defineProperty(response, 'redirected', { value: true })
    return response
  }

  it.each<[string, () => Response]>([
    ['a guest shell', () => shellResponse('tok2', { 'X-Suite-Guest': '1' })],
    ['a redirected shell', redirected],
    ['a failed shell', () => shellResponse('tok2', {}, 500)],
    ['another build', () => shellResponse('tok2', { 'X-Suite-Build': '99' })],
  ])('keeps the old shell and writes nothing for %s', async (_label, make) => {
    await visit()
    const before = keys()
    window.csrf_token = 'tok2'
    shell = make

    await visit('n2', 'p2')

    expect(keys()).toEqual(before)
    expect(header(SHELL_KEY, 'x-visited-csrf')).toBe('tok1')
  })
})

describe('who gets no copy', () => {
  async function expectNothing() {
    expect(requests).toEqual([])
    expect(openedNames).toEqual([])
  }

  it('someone with no cookie user', async () => {
    state.user = null
    await visit()
    await expectNothing()
  })

  it('a composite presentation', async () => {
    const { rememberVisit } = await loadStore()
    showPresentation('n1', 'p1', { is_composite: 1 })
    await rememberVisit('p1')
    await expectNothing()
  })

  it('a page that is offline', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false })
    await visit()
    await expectNothing()
  })

  it('the kill switch', async () => {
    window.disable_slides_service_worker = 1 as never
    await visit()
    await expectNothing()
  })

  it('a pinned presentation', async () => {
    localStorage.setItem('slides-offline-copy:p1', JSON.stringify({ node: 'n1', keys: [] }))
    await visit()
    await expectNothing()
  })

  it('a pinned presentation, until the pin is gone on the same page', async () => {
    localStorage.setItem('slides-offline-copy:p1', JSON.stringify({ node: 'n1', keys: [] }))
    const { rememberVisit } = await loadStore()
    showPresentation()

    await rememberVisit('p1')
    await expectNothing()

    localStorage.removeItem('slides-offline-copy:p1')
    await rememberVisit('p1')

    expect(keys()).toContain('/d/n1')
  })

  it('a page no worker controls', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      serviceWorker: { controller: null, addEventListener: () => {} },
    })
    await visit()
    expect(requests).toEqual([])
    expect(named.get(VISITED)).toBeUndefined()
  })

  it('a refused data GET stores nothing', async () => {
    const [, , media] = dataUrls('n1', 'p1')
    refused.add(media)
    await visit()
    expect(keys()).toEqual([])
  })
})

describe('a build swap', () => {
  beforeEach(() => {
    seedShell('99', 'tok1')
    seedFile('/assets/suite/frontend/assets/old-z9.js', '99')
    seedFile(ENTRY, '99')
    seedNode('old', 500)
  })

  it('leaves the new shell its files and removes the old ones', async () => {
    const order: string[] = []
    visited().putHook = (key) => {
      order.push(key)
    }

    await visit()

    expect(header(SHELL_KEY, 'x-visited-build')).toBe('100')
    expect(keys()).not.toContain('/assets/suite/frontend/assets/old-z9.js')
    expect(order.indexOf(SHELL_KEY)).toBeGreaterThan(order.indexOf(CHUNK))
    expect(order.indexOf(dataUrl('n1', 'p1'))).toBeGreaterThan(order.indexOf(SHELL_KEY))
    expect(order.at(-1)).toBe('/d/n1')
  })

  it('refetches a file the last build also listed, so the delete keeps it', async () => {
    await visit()

    expect(fileFetches()).toContain(ENTRY)
    expect(header(ENTRY, 'x-visited-build')).toBe('100')
  })

  it('keeps the other nodes working under the new shell', async () => {
    await visit()

    expect(keys()).toContain('/d/old')
    expect(keys()).toContain(dataUrl('old', 'id-old'))
  })

  it('deletes by the stored shell, so an interleaved newer capture keeps its files', async () => {
    const newer = '/assets/suite/frontend/assets/newer-n1.js'
    visited().afterPut = (key) => {
      if (key === SHELL_KEY && header(SHELL_KEY, 'x-visited-build') === '100') {
        seedShell('200', 'tok1')
        seedFile(newer, '200')
      }
    }

    await visit()

    expect(header(SHELL_KEY, 'x-visited-build')).toBe('200')
    expect(keys()).toContain(newer)
    expect(keys()).not.toContain(CHUNK)
  })

  it.each([
    ['a file', CHUNK],
    ['the shell', SHELL_KEY],
  ])('keeps the old copy whole when %s fails to store', async (_label, failing) => {
    visited().putHook = (key) => {
      if (key === failing) {
        throw new TypeError('network')
      }
    }

    await visit()

    expect(header(SHELL_KEY, 'x-visited-build')).toBe('99')
    expect(keys()).toContain('/assets/suite/frontend/assets/old-z9.js')
    expect(keys()).not.toContain('/d/n1')
    expect(keys()).not.toContain(dataUrl('n1', 'p1'))
  })
})

describe('the limit', () => {
  beforeEach(() => {
    seedShell()
    for (const file of FILES) {
      seedFile(file, '100')
    }
  })

  function seedNodes(count: number) {
    for (let i = 1; i <= count; i++) {
      seedNode(`old${i}`, i * 10)
    }
  }

  it('drops the oldest node at the 21st and keeps the shell and files', async () => {
    seedNodes(20)

    await visit()

    expect(keys()).not.toContain('/d/old1')
    expect(keys()).not.toContain(dataUrl('old1', 'id-old1'))
    expect(keys()).toContain('/d/old2')
    expect(keys()).toContain('/d/n1')
    expect(keys()).toContain(SHELL_KEY)
    for (const file of FILES) {
      expect(keys()).toContain(file)
    }
  })

  it('trims an overshoot on the next capture', async () => {
    seedNodes(22)

    await visit()

    expect(keys()).not.toContain('/d/old1')
    expect(keys()).not.toContain('/d/old2')
    expect(keys()).not.toContain('/d/old3')
    expect(keys()).toContain('/d/old4')
  })

  it('sweeps data whose node has no marker', async () => {
    const stray = dataUrl('gone', 'id-gone')
    visited().store.set(stray, new Response('old', { headers: { 'x-visited-node': 'gone' } }))

    await visit()

    expect(keys()).not.toContain(stray)
  })
})

describe('a full disk', () => {
  beforeEach(() => {
    seedShell()
    for (const file of FILES) {
      seedFile(file, '100')
    }

    seedNode('older', 10)
    seedNode('newer', 20)
  })

  it('drops the oldest node and retries the put once', async () => {
    let failures = 0
    visited().putHook = (key) => {
      if (key === '/d/n1' && failures++ === 0) {
        throw new DOMException('full', 'QuotaExceededError')
      }
    }

    await visit()

    expect(keys()).toContain('/d/n1')
    expect(keys()).not.toContain('/d/older')
    expect(keys()).toContain('/d/newer')
    expect(failures).toBe(2)
  })

  it('stops quietly when the retry fails too', async () => {
    visited().putHook = (key) => {
      if (key === '/d/n1') {
        throw new DOMException('full', 'QuotaExceededError')
      }
    }

    await expect(visit()).resolves.toBeUndefined()

    expect(keys()).not.toContain('/d/n1')
    expect(keys()).toContain('/d/newer')
  })

  it('never asks the browser to keep a visited copy', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      serviceWorker: { controller: {}, addEventListener: () => {} },
      storage: { persist },
    })

    await visit()

    expect(persist).not.toHaveBeenCalled()
  })
})

describe('forgetting a node', () => {
  it('removes its marker and data and nothing else', async () => {
    await visit()
    await visit('n2', 'p2')
    const { forgetVisitedNode } = await loadStore()

    await forgetVisitedNode('n1')

    expect(keys()).not.toContain('/d/n1')
    for (const url of dataUrls('n1', 'p1')) {
      expect(keys()).not.toContain(url)
    }

    expect(keys()).toContain('/d/n2')
    expect(keys()).toContain(dataUrl('n2', 'p2'))
    expect(keys()).toContain(SHELL_KEY)
    expect(keys()).toContain(ENTRY)
  })

  it('never creates the cache', async () => {
    const { forgetVisitedNode } = await loadStore()

    await forgetVisitedNode('n1')

    expect(openedNames).toEqual([])
  })

  it('stops a capture in flight', async () => {
    const release = holdFetches()
    const { rememberVisit, forgetVisitedNode } = await loadStore()
    showPresentation()
    const capture = rememberVisit('p1')
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))

    await forgetVisitedNode('n1')
    release()
    await capture

    expect(keys()).toEqual([])
  })
})

describe('a change during the capture', () => {
  async function during(change: () => void) {
    const release = holdFetches()
    const { rememberVisit } = await loadStore()
    showPresentation()
    const capture = rememberVisit('p1')
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    change()
    release()
    await capture
  }

  it('writes nothing once a Save copy has made a pin', async () => {
    await during(() =>
      localStorage.setItem('slides-offline-copy:p1', JSON.stringify({ node: 'n1', keys: [] })),
    )
    expect(keys()).toEqual([])
  })

  it('writes nothing once the user has changed', async () => {
    await during(() => {
      state.user = 'b@example.com'
    })
    expect(keys()).toEqual([])
  })

  it('writes nothing once the user has logged out', async () => {
    await during(() => {
      state.user = null
    })
    expect(keys()).toEqual([])
  })

  it('never brings back a cache wiped under it', async () => {
    await during(() => {
      named.delete(VISITED)
    })
    expect(named.get(VISITED)).toBeUndefined()
  })

  it('stops when the page moves to another presentation', async () => {
    const release = holdFetches()
    const { rememberVisit } = await loadStore()
    showPresentation()
    const first = rememberVisit('p1')
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    showPresentation('n2', 'p2')
    const second = rememberVisit('p2')
    release()
    await Promise.all([first, second])

    expect(keys()).not.toContain('/d/n1')
    expect(keys()).toContain('/d/n2')
  })

  it('stops when the surface goes away', async () => {
    const release = holdFetches()
    const { rememberVisit, cancelVisit } = await loadStore()
    showPresentation()
    const capture = rememberVisit('p1')
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    cancelVisit()
    release()
    await capture

    expect(keys()).toEqual([])
  })
})

describe('rememberVisit', () => {
  it.each<[string, () => void]>([
    [
      'the cache will not open',
      () =>
        vi.stubGlobal('caches', {
          open: async () => {
            throw new Error('broken')
          },
        }),
    ],
    [
      'the network fails',
      () =>
        vi.stubGlobal('fetch', async () => {
          throw new TypeError('offline')
        }),
    ],
  ])('never rejects when %s', async (_label, breakIt) => {
    breakIt()

    await expect(visit()).resolves.toBeUndefined()
  })

  it('waits three seconds, then for an idle moment', async () => {
    const waits: number[] = []
    let idle = () => {}

    vi.stubGlobal('requestIdleCallback', (run: () => void) => {
      idle = run
    })
    vi.stubGlobal('setTimeout', (run: () => void, ms: number) => {
      waits.push(ms)
      queueMicrotask(run)
      return 0
    })
    const { rememberVisit } = await loadStore()
    showPresentation()

    const capture = rememberVisit('p1')
    await vi.waitFor(() => expect(waits).toContain(3000))
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(requests).toEqual([])

    idle()
    await capture

    expect(requests.length).toBeGreaterThan(0)
  })
})
