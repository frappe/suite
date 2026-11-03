import { afterEach, beforeEach, vi } from 'vitest'
import { ref } from 'vue'

const presentationDoc = ref<Record<string, unknown> | null>(null)
export const presentationId = ref('')
const viewOnly = ref(false)
export const slides = ref<unknown[]>([])
const loadedChunks: string[] = []
export const state = { user: 'a@example.com' as string | null }

vi.mock('@/apps/slides/stores/presentation', () => ({ presentationDoc, presentationId, viewOnly }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: (src: string) => src }))
vi.mock('@/apps/slides/utils/loadedAssets', () => ({ loadedAssets: () => loadedChunks }))
vi.mock('@/apps/slides/pages/Slideshow.vue', () => ({ default: {} }))
vi.mock('@/platform/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/session')>()),
  getCookieSessionUser: () => state.user,
}))

export const VISITED = 'slides-visited'
export const SHELL_KEY = '/slides-visited-shell'
export const ENTRY = '/assets/suite/frontend/assets/index-a1.js'
const STYLE = '/assets/suite/frontend/assets/index-c3.css'
export const CHUNK = '/assets/suite/frontend/assets/SlidesSurface-d4.js'
export const FILES = [ENTRY, STYLE, CHUNK]

export function dataUrl(node: string, id: string) {
  const [url] = dataUrls(node, id)
  return url
}

export function dataUrls(node: string, id: string) {
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
    // a real put reads the whole body first, so a body that errors rejects the put
    const body = await response.arrayBuffer()
    const { status, headers } = response
    this.store.set(key, new Response(body.byteLength ? body : null, { status, headers }))
    this.afterPut?.(key)
  }
  async delete(key: string) {
    return this.store.delete(key)
  }
}

export const named = new Map<string, FakeCache>()
export const openedNames: string[] = []
export const requests: { url: string; isMarked: boolean }[] = []
export const refused = new Set<string>()
export const answers = new Map<string, string>()
export const fake = {
  shell: () => new Response() as Response,
  holdFetch: null as Promise<unknown> | null,
  clock: 0,
  lockRequests: 0,
  hasWholeBodies: false,
}
export const stalledBodies = new Set<string>()
export const TWO_MINUTES = 120_000
export const lockLimits = new Set<() => void>()

// what fetch gives: abort errors a body still on its way; one received whole is past that
function bodyFor(url: string, text: string, signal?: AbortSignal | null) {
  const isWhole = fake.hasWholeBodies
  return new ReadableStream({
    start(controller) {
      if (!isWhole) {
        signal?.addEventListener('abort', () =>
          controller.error(new DOMException('aborted', 'AbortError')),
        )
      }
    },
    pull(controller) {
      if (stalledBodies.has(url)) {
        return new Promise<void>(() => {})
      }

      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

async function afterTurn(before: Promise<unknown>, run: () => Promise<unknown>) {
  await before
  return run()
}

// one holder at a time, across every tab, in the order they asked
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    request(_name: string, run: () => Promise<unknown>) {
      fake.lockRequests++
      const turn = afterTurn(tail, run)
      tail = turn.catch(() => {})
      return turn
    },
  }
}

export function holdFetches() {
  let release!: () => void

  fake.holdFetch = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => release()
}

function open(name = VISITED) {
  const cache = named.get(name) ?? new FakeCache()
  named.set(name, cache)
  return cache
}

export function visited() {
  return open()
}

export function keys() {
  return [...visited().store.keys()]
}

export function fetchedUrls() {
  return requests.map((request) => request.url)
}

export function shellFetches() {
  return fetchedUrls().filter((url) => url.startsWith('/d/'))
}

export function fileFetches() {
  return fetchedUrls().filter((url) => url.startsWith('/assets/'))
}

export function header(key: string, name: string) {
  return visited().store.get(key)?.headers.get(name)
}

function shellHtml(token = 'tok1') {
  return `<html><head>
    <script>window.csrf_token = '${token}'</script>
    <script type="module" src="${ENTRY}"></script>
    <link rel="stylesheet" href="${STYLE}">
  </head></html>`
}

export function shellResponse(token = 'tok1', headers: Record<string, string> = {}, status = 200) {
  return new Response(shellHtml(token), {
    status,
    headers: { 'Content-Type': 'text/html', 'X-Suite-Build': '100', ...headers },
  })
}

export function seedNode(node: string, time: number) {
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

export function seedShell(build = '100', token = 'tok1') {
  visited().store.set(
    SHELL_KEY,
    new Response(shellHtml(token), {
      headers: { 'x-visited-build': build, 'x-visited-csrf': token, 'Content-Type': 'text/html' },
    }),
  )
}

export function seedFile(path: string, build: string) {
  visited().store.set(path, new Response('old file', { headers: { 'x-visited-build': build } }))
}

export async function loadStore() {
  vi.resetModules()
  return import('./visitedCopies')
}

export function showPresentation(node = 'n1', id = 'p1', doc: Record<string, unknown> = {}) {
  presentationId.value = id
  presentationDoc.value = { node, is_composite: 0, ...doc }
}

export async function visit(node = 'n1', id = 'p1') {
  const { rememberVisit } = await loadStore()
  showPresentation(node, id)
  await rememberVisit(id)
}

function resetState() {
  named.clear()
  openedNames.length = 0
  requests.length = 0
  refused.clear()
  answers.clear()
  slides.value = []
  loadedChunks.splice(0, loadedChunks.length, CHUNK)
  localStorage.clear()
  state.user = 'a@example.com'
  fake.shell = () => shellResponse()
  fake.holdFetch = null
  fake.clock = 1000
  fake.lockRequests = 0
  fake.hasWholeBodies = false
  stalledBodies.clear()
  lockLimits.clear()
  window.csrf_token = 'tok1'
  delete window.disable_slides_service_worker
}

function stubClock() {
  vi.spyOn(Date, 'now').mockImplementation(() => fake.clock)
  // the wait for an idle moment has its own test
  vi.stubGlobal('requestIdleCallback', (run: () => void) => run())
  vi.stubGlobal('setTimeout', (run: () => void, wait?: number) => {
    if (wait === TWO_MINUTES) {
      lockLimits.add(run)
      return run
    }

    queueMicrotask(run)
    return 0
  })
  vi.stubGlobal('clearTimeout', (timer: () => void) => lockLimits.delete(timer))
}

function stubBrowser() {
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    serviceWorker: { controller: {}, addEventListener: () => {} },
    locks: fakeLocks(),
  })
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      openedNames.push(name)
      return open(name)
    },
    has: async (name: string) => named.has(name),
    delete: async (name: string) => named.delete(name),
  })
}

function dataResponse(url: string, signal?: AbortSignal | null) {
  if (refused.has(url)) {
    return new Response('', { status: 403 })
  }

  if (url.startsWith('/api/')) {
    return new Response(bodyFor(url, answers.get(url) ?? `{"url":"${url}"}`, signal), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(bodyFor(url, 'file', signal), {
    status: 200,
    headers: { 'Content-Type': 'text/javascript' },
  })
}

async function fakeFetch(url: string, init?: RequestInit) {
  // frappe-ui asks for its translations on import
  if (url.includes('get_boot_translations')) {
    return new Response('{}')
  }

  // the warm before the capture, not part of it
  if (url.includes('get_templates')) {
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } })
  }

  requests.push({ url, isMarked: new Headers(init?.headers).has('x-slides-pin') })
  await fake.holdFetch
  if (init?.signal?.aborted) {
    throw new DOMException('aborted', 'AbortError')
  }

  if (url.startsWith('/d/')) {
    return fake.shell()
  }

  return dataResponse(url, init?.signal)
}

export function installFakes() {
  beforeEach(() => {
    resetState()
    vi.stubEnv('VITE_SLIDES_SW', '1')
    vi.stubGlobal('__SUITE_BUILD__', '100')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubClock()
    stubBrowser()
    vi.stubGlobal('fetch', fakeFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
}
